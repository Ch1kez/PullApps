package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Wails GUI apps inherit a minimal PATH from launchd that doesn't include the
// Homebrew bin dirs, so PATH-relative exec lookups won't find ipatool /
// ideviceinstaller / idevice_id. Probe known absolute locations instead, so
// the same binary works on Apple Silicon (/opt/homebrew) and Intel
// (/usr/local) Macs without a per-arch build.
func findTool(name string) string {
	paths := []string{}
	// App-managed override, checked first: lets us ship a patched tool (e.g. an
	// ipatool build carrying the June 2026 `26HOTFIX24` auth-endpoint fix that
	// upstream Homebrew hasn't released yet) under our own Application Support
	// dir, without touching Homebrew's binary. Drop a binary at
	// ~/Library/Application Support/ipatool-gui/bin/<name> to take precedence.
	if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths, filepath.Join(home, "Library", "Application Support", "ipatool-gui", "bin", name))
	}
	// Self-contained .app: build-app.sh bundles the patched ipatool at
	// <app>/Contents/Resources/bin/<name> so a distributed app works without
	// Homebrew or Go. exe is <app>/Contents/MacOS/<binary>, so Resources/bin is
	// a sibling of MacOS. Checked after the Application Support override (a
	// manual drop-in still wins) but before Homebrew (which may be stale).
	if exe, err := os.Executable(); err == nil {
		paths = append(paths, filepath.Join(filepath.Dir(exe), "..", "Resources", "bin", name))
	}
	paths = append(paths,
		"/opt/homebrew/bin/"+name, // Apple Silicon Homebrew
		"/usr/local/bin/"+name,    // Intel Homebrew (or Apple Silicon under Rosetta)
		"/usr/bin/"+name,          // system binaries (plutil, security)
	)
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// Last resort: PATH lookup. Usually empty in a Wails GUI but worth trying.
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	// Return the canonical Homebrew path so user-facing errors show a real,
	// install-able location (not the Application Support override that may not exist).
	return "/opt/homebrew/bin/" + name
}

var (
	ipatoolBin       = findTool("ipatool")
	idevInstallerBin = findTool("ideviceinstaller")
	idevIDBin        = findTool("idevice_id")
	plutilBin        = findTool("plutil")
	securityBin      = findTool("security")
)

// ipatool stores its account in the macOS Keychain under this service name
// (see ipatool source: cmd/constants.go). The stored value is a JSON blob
// containing directoryServicesIdentifier (DSID), email, name, etc.
const ipatoolKeychainService = "ipatool-auth.service"

// dataAsString rewrites every <data>BASE64</data> in a plist XML stream as
// <string>BASE64</string> so that plutil's JSON converter — which refuses to
// emit binary data — can handle the document. Used for iTunesMetadata, which
// ideviceinstaller returns as a <data>-wrapped nested plist.
var dataAsString = regexp.MustCompile(`(?s)<data>\s*([A-Za-z0-9+/=\s]+?)\s*</data>`)

// itemIDRe pulls itemId (the App Store numeric ID) straight out of an
// iTunesMetadata.plist's XML — far simpler than parsing the whole inner plist,
// which contains <date> elements plutil also rejects.
var itemIDRe = regexp.MustCompile(`<key>itemId</key>\s*<integer>(\d+)</integer>`)

// storefrontRe pulls the two-letter ISO country code for the App Store the app
// was purchased from (e.g. "AU", "US"). Region-locked apps (AusPost, Service
// NSW, etc.) only appear in their home country's lookup endpoint, so we need
// to query the right one to find their artwork. The value is stored
// case-insensitively across iOS versions (older: uppercase, newer: lowercase).
var storefrontRe = regexp.MustCompile(`<key>storefrontCountryCode</key>\s*<string>([A-Za-z]{2})</string>`)

// plistToXML normalises an iTunesMetadata blob to XML form so our regex
// extractors work. Many recent iOS builds store iTunesMetadata as binary plist
// (bplist00) instead of XML — the regex would silently miss every key. A
// no-op when input is already XML.
func plistToXML(b []byte) []byte {
	if !bytes.HasPrefix(b, []byte("bplist00")) {
		return b
	}
	cmd := exec.Command(plutilBin, "-convert", "xml1", "-o", "-", "-")
	cmd.Stdin = bytes.NewReader(b)
	out, err := cmd.Output()
	if err != nil {
		return b
	}
	return out
}

type App struct {
	ctx          context.Context
	dsidOnce     sync.Once
	cachedDSID   string
}

func NewApp() *App { return &App{} }

// dsidCachePath returns the on-disk cache for the signed-in DSID. The DSID is
// not a secret (it's just an account number), so storing it in plaintext is
// fine and lets us avoid prompting the user for keychain access on every launch.
func dsidCachePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, "Library", "Application Support", "ipatool-gui", "dsid")
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

type AuthInfo struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	Success       bool   `json:"success"`
	Authenticated bool   `json:"authenticated"`
	Error         string `json:"error,omitempty"`
}

type LoginResult struct {
	Success  bool   `json:"success"`
	Needs2FA bool   `json:"needs2FA"`
	Error    string `json:"error,omitempty"`
}

type AppResult struct {
	ID        int64   `json:"id"`
	BundleID  string  `json:"bundleID"`
	Name      string  `json:"name"`
	Version   string  `json:"version"`
	Price     float64 `json:"price"`
}

type SearchResponse struct {
	Count int         `json:"count"`
	Apps  []AppResult `json:"apps"`
}

type InstalledApp struct {
	BundleID   string `json:"bundleID"`
	Name       string `json:"name"`
	Version    string `json:"version"`
	DSID       string `json:"dsid"`
	AppStoreID string `json:"appStoreID"` // numeric Apple "itemId"; empty if app wasn't installed from the App Store
	Storefront string `json:"storefront"` // two-letter country code (e.g. "AU", "US"); empty if unknown
}

type Version struct {
	ExternalID     string `json:"externalID"`
	DisplayVersion string `json:"displayVersion"`
	ReleaseDate    string `json:"releaseDate"`
}

type DownloadResult struct {
	Success     bool   `json:"success"`
	OutputPath  string `json:"outputPath,omitempty"`
	BundleID    string `json:"bundleID,omitempty"`
	Name        string `json:"name,omitempty"`
	Version     string `json:"version,omitempty"`
	Error       string `json:"error,omitempty"`
}

// InstallResult reports the outcome of installing an .ipa onto a connected
// iPhone via ideviceinstaller.
type InstallResult struct {
	Success  bool   `json:"success"`
	BundleID string `json:"bundleID,omitempty"`
	Name     string `json:"name,omitempty"`
	Version  string `json:"version,omitempty"`
	Error    string `json:"error,omitempty"`
}

func (a *App) runIpatool(args ...string) ([]byte, []byte, error) {
	full := append([]string{"--format", "json", "--non-interactive"}, args...)
	cmd := exec.Command(ipatoolBin, full...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	return stdout.Bytes(), stderr.Bytes(), err
}

// firstJSON returns the last JSON object on stdout (ipatool emits log lines as JSON,
// with the result line typically last). Falls back to first non-empty line.
func firstJSON(out []byte) []byte {
	lines := bytes.Split(out, []byte("\n"))
	var last []byte
	for _, l := range lines {
		l = bytes.TrimSpace(l)
		if len(l) > 0 && l[0] == '{' {
			last = l
		}
	}
	return last
}

func (a *App) AuthInfo() AuthInfo {
	out, errOut, err := a.runIpatool("auth", "info")
	line := firstJSON(out)
	if line == nil {
		line = firstJSON(errOut)
	}
	if line == nil {
		return AuthInfo{Authenticated: false, Error: errOrEmpty(err)}
	}
	var raw struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Success bool   `json:"success"`
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(line, &raw)
	if !raw.Success && err != nil {
		return AuthInfo{Authenticated: false, Error: firstNonEmpty(raw.Error, raw.Message, err.Error())}
	}
	return AuthInfo{
		Name:          raw.Name,
		Email:         raw.Email,
		Success:       raw.Success,
		Authenticated: raw.Success && raw.Email != "",
	}
}

func (a *App) Login(email, password, authCode string) LoginResult {
	if strings.TrimSpace(email) == "" || strings.TrimSpace(password) == "" {
		return LoginResult{Error: "email and password are required"}
	}
	args := []string{"auth", "login", "-e", email, "-p", password}
	if strings.TrimSpace(authCode) != "" {
		args = append(args, "--auth-code", authCode)
	}
	a.InvalidateSignedInDSID()
	out, errOut, err := a.runIpatool(args...)
	line := firstJSON(out)
	if line == nil {
		line = firstJSON(errOut)
	}
	var raw struct {
		Success bool   `json:"success"`
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if line != nil {
		_ = json.Unmarshal(line, &raw)
	}
	if err == nil && raw.Success {
		return LoginResult{Success: true}
	}
	msg := firstNonEmpty(raw.Error, raw.Message, errOrEmpty(err))
	if msg == "" {
		msg = "login failed"
	}
	// Only treat the response as "2FA required" if we haven't already supplied
	// a code. Otherwise an error mentioning "auth code" means the code was wrong,
	// not that we need to prompt again.
	if strings.TrimSpace(authCode) == "" && needs2FA(msg) {
		return LoginResult{Needs2FA: true, Error: msg}
	}
	return LoginResult{Error: msg}
}

func needs2FA(msg string) bool {
	s := strings.ToLower(msg)
	// ipatool's specific message is:
	//   "2FA code is required; run the command again and supply a code using the `--auth-code` flag"
	return strings.Contains(s, "2fa code is required") ||
		strings.Contains(s, "auth-code` flag") ||
		(strings.Contains(s, "is required") && (strings.Contains(s, "2fa") || strings.Contains(s, "auth code")))
}

func (a *App) Logout() error {
	_, _, err := a.runIpatool("auth", "revoke")
	a.InvalidateSignedInDSID()
	return err
}

func (a *App) Search(term string, limit int) (SearchResponse, error) {
	if strings.TrimSpace(term) == "" {
		return SearchResponse{}, errors.New("search term is empty")
	}
	if limit <= 0 {
		limit = 10
	}
	out, errOut, err := a.runIpatool("search", term, "--limit", fmt.Sprintf("%d", limit))
	line := firstJSON(out)
	if line == nil {
		line = firstJSON(errOut)
	}
	if line == nil {
		return SearchResponse{}, fmt.Errorf("no JSON output: %s", errOrEmpty(err))
	}
	var raw struct {
		Count   int         `json:"count"`
		Apps    []AppResult `json:"apps"`
		Error   string      `json:"error"`
		Message string      `json:"message"`
	}
	if jerr := json.Unmarshal(line, &raw); jerr != nil {
		return SearchResponse{}, jerr
	}
	if err != nil && len(raw.Apps) == 0 {
		return SearchResponse{}, errors.New(firstNonEmpty(raw.Error, raw.Message, err.Error()))
	}
	return SearchResponse{Count: raw.Count, Apps: raw.Apps}, nil
}

// ListInstalledApps queries a USB-connected iOS device for installed user apps
// via ideviceinstaller, parses the XML plist output via plutil, and returns
// a sorted list of {bundleID, name, version}.
func (a *App) ListInstalledApps() ([]InstalledApp, error) {
	if _, err := os.Stat(idevInstallerBin); err != nil {
		return nil, errors.New("ideviceinstaller not found at " + idevInstallerBin + " — install with `brew install ideviceinstaller`")
	}

	// Request iTunesMetadata as well — that plist carries the App Store itemId
	// (numeric ID), purchaseDate, and the original purchasing Apple ID. With it
	// we can download by -i (numeric App ID), which works even for delisted apps
	// that Apple has wiped from the public bundle-ID lookup index.
	// Note: -a restricts the result to ONLY the listed attributes, so we have to
	// re-include the bundle/version/display-name fields too.
	cmd := exec.Command(idevInstallerBin, "list", "--user",
		"-a", "CFBundleIdentifier",
		"-a", "CFBundleDisplayName",
		"-a", "CFBundleName",
		"-a", "CFBundleShortVersionString",
		"-a", "CFBundleVersion",
		"-a", "ApplicationDSID",
		"-a", "iTunesMetadata",
		"--xml")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		// Common error: no device connected / not trusted
		if strings.Contains(strings.ToLower(msg), "no device found") {
			msg = "No iPhone detected. Connect via USB, unlock, and tap Trust if prompted."
		}
		return nil, errors.New(msg)
	}

	// plutil refuses to convert any plist containing <data> elements to JSON
	// (JSON has no native binary type, and plutil declines to emit base64
	// strings). Pre-rewrite <data>...</data> as <string>...</string> — the
	// base64 contents are already text, so the substitution is safe and the
	// values come through as strings we can decode ourselves.
	// We also strip embedded whitespace from the captured base64: plutil's XML
	// formatter wraps data at 64 chars with newlines, and Go's strict
	// base64.StdEncoding.DecodeString rejects them.
	rawXML := dataAsString.ReplaceAllStringFunc(string(stdout.Bytes()), func(match string) string {
		sub := dataAsString.FindStringSubmatch(match)
		cleanB64 := strings.Join(strings.Fields(sub[1]), "")
		return "<string>" + cleanB64 + "</string>"
	})

	// Convert plist XML → JSON via plutil so we can unmarshal without a plist lib
	pcmd := exec.Command(plutilBin, "-convert", "json", "-o", "-", "-")
	pcmd.Stdin = strings.NewReader(rawXML)
	var jbuf, perr bytes.Buffer
	pcmd.Stdout = &jbuf
	pcmd.Stderr = &perr
	if err := pcmd.Run(); err != nil {
		return nil, fmt.Errorf("plutil: %s: %s", err, strings.TrimSpace(perr.String()))
	}

	var arr []map[string]any
	if jerr := json.Unmarshal(jbuf.Bytes(), &arr); jerr != nil {
		return nil, fmt.Errorf("parse: %w", jerr)
	}

	apps := make([]InstalledApp, 0, len(arr))
	for _, m := range arr {
		bundleID, _ := m["CFBundleIdentifier"].(string)
		if bundleID == "" {
			continue
		}
		name, _ := m["CFBundleDisplayName"].(string)
		if name == "" {
			name, _ = m["CFBundleName"].(string)
		}
		if name == "" {
			name = bundleID
		}
		version, _ := m["CFBundleShortVersionString"].(string)
		if version == "" {
			version, _ = m["CFBundleVersion"].(string)
		}
		// ApplicationDSID is the Apple ID account number that holds the license
		// for this install. plutil emits it as a JSON number → float64 in Go.
		var dsid string
		switch v := m["ApplicationDSID"].(type) {
		case float64:
			dsid = strconv.FormatInt(int64(v), 10)
		case string:
			dsid = v
		}
		// iTunesMetadata is a nested plist (App Store purchase metadata). plutil
		// renders <data> as a base64 string in JSON, so we have to decode and then
		// re-parse the inner plist to pull out itemId (the App Store ID) and the
		// storefront country code (needed for region-locked artwork lookup).
		var appStoreID, storefront string
		if b64, ok := m["iTunesMetadata"].(string); ok && b64 != "" {
			if raw, derr := base64.StdEncoding.DecodeString(b64); derr == nil {
				xml := plistToXML(raw)
				if id := itemIDRe.FindSubmatch(xml); len(id) >= 2 {
					appStoreID = string(id[1])
				}
				if sf := storefrontRe.FindSubmatch(xml); len(sf) >= 2 {
					storefront = strings.ToLower(string(sf[1]))
				}
			}
		}
		apps = append(apps, InstalledApp{
			BundleID:   bundleID,
			Name:       name,
			Version:    version,
			DSID:       dsid,
			AppStoreID: appStoreID,
			Storefront: storefront,
		})
	}

	sort.Slice(apps, func(i, j int) bool {
		return strings.ToLower(apps[i].Name) < strings.ToLower(apps[j].Name)
	})
	return apps, nil
}

// InstallIPA installs a locally-downloaded .ipa onto the connected iPhone via
// ideviceinstaller, streaming a percentage to the UI as `install:progress`
// events and finishing with an `install:done` event carrying the result object.
//
// ideviceinstaller install writes its progress as carriage-return-updated lines
// on stdout:
//
//	Copying '/path/App.ipa' to device... DONE.
//	Install: CreatingStagingDirectory (5%)
//	Install: ExtractingPackage (15%)
//	...
//	Install: Complete
//
// We scan that stream, emit each (pct, step), and surface the final state both
// as `install:done` and as the method's return value (for the Promise path).
func (a *App) InstallIPA(ipaPath string) InstallResult {
	if strings.TrimSpace(ipaPath) == "" {
		return InstallResult{Error: "no .ipa file selected"}
	}
	if _, err := os.Stat(ipaPath); err != nil {
		return InstallResult{Error: fmt.Sprintf("file not found: %s", ipaPath)}
	}
	if _, err := os.Stat(idevInstallerBin); err != nil {
		return InstallResult{Error: "ideviceinstaller not found at " + idevInstallerBin + " — install with `brew install ideviceinstaller`"}
	}

	// Send a 0% kick-off so the UI can disable/flip the button immediately.
	wruntime.EventsEmit(a.ctx, "install:start", map[string]any{"ipa": ipaPath})

	cmd := exec.Command(idevInstallerBin, "install", ipaPath)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return InstallResult{Error: err.Error()}
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return InstallResult{Error: err.Error()}
	}

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	var lastPct float64
	for sc.Scan() {
		line := sc.Text()
		if pct, ok := parseInstallPct(line); ok {
			lastPct = pct
			wruntime.EventsEmit(a.ctx, "install:progress", map[string]any{
				"pct":  pct,
				"step": strings.TrimSpace(line),
			})
		}
	}
	// Whether the stream ended with an explicit 100% or not, emit one so the
	// bar fills before the done event tears the progress UI down.
	if lastPct < 100 {
		wruntime.EventsEmit(a.ctx, "install:progress", map[string]any{
			"pct": 100, "step": "Install: Complete",
		})
	}
	waitErr := cmd.Wait()
	var scanErr error
	if err := sc.Err(); err != nil {
		scanErr = err
	}

	res := InstallResult{}
	name := appNameFromIPA(ipaPath)
	if name != "" {
		res.Name = name
	}
	if waitErr != nil || scanErr != nil {
		msg := firstNonEmpty(errOrEmpty(waitErr), errOrEmpty(scanErr))
		if strings.Contains(strings.ToLower(msg), "no device found") {
			msg = "No iPhone detected. Connect via USB, unlock, and tap Trust if prompted."
		}
		res.Error = msg
	} else {
		res.Success = true
	}
	wruntime.EventsEmit(a.ctx, "install:done", res)
	return res
}

// parseInstallPct extracts the integer percentage from an ideviceinstaller
// progress line like "Install: ExtractingPackage (15%)". Returns ok=false for
// lines that carry no percentage (e.g. the "Copying ... to device" preamble).
func parseInstallPct(line string) (float64, bool) {
	// ideviceinstaller writes e.g. "... (15%)" with optional CRLF; grab the
	// last parenthesised integer before a % sign.
	open := strings.LastIndexByte(line, '(')
	closeI := strings.LastIndexByte(line, ')')
	if open < 0 || closeI < open {
		return 0, false
	}
	mid := strings.TrimSuffix(strings.TrimSpace(line[open+1:closeI]), "%")
	mid = strings.TrimSpace(mid)
	if mid == "" {
		return 0, false
	}
	pctF, err := strconv.ParseFloat(mid, 64)
	if err != nil {
		return 0, false
	}
	if pctF < 0 || pctF > 100 {
		return 0, false
	}
	return pctF, true
}

// DeviceConnected returns true when at least one paired iOS device is currently
// reachable over USB. Used by the UI to "wake up" the From-iPhone button as
// soon as the user plugs a phone in. Polled every few seconds — `idevice_id -l`
// is a fast no-network call that just enumerates the usbmuxd registry.
func (a *App) DeviceConnected() bool {
	if _, err := os.Stat(idevIDBin); err != nil {
		return false
	}
	cmd := exec.Command(idevIDBin, "-l")
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(out)) != ""
}

// SignedInDSID returns the directoryServicesIdentifier of the Apple ID that
// ipatool is currently signed in as. The DSID is the per-account number that
// Apple uses to scope purchase/install licenses, and it matches the
// ApplicationDSID stamped into every installed app's plist on the device.
//
// Cached per-process via sync.Once and also persisted to a plain file under
// ~/Library/Application Support/ipatool-gui/dsid so subsequent launches don't
// trigger a keychain access prompt. The DSID is not a credential — it's a
// public-by-construction account number — so plaintext persistence is fine.
//
// Returns "" if the entry can't be read (signed out, denied, etc.).
func (a *App) SignedInDSID() string {
	a.dsidOnce.Do(func() {
		// 1. Try the on-disk cache first — no prompt, instant.
		if p := dsidCachePath(); p != "" {
			if b, err := os.ReadFile(p); err == nil {
				if v := strings.TrimSpace(string(b)); v != "" {
					a.cachedDSID = v
					return
				}
			}
		}
		// 2. Cache miss — read the keychain entry (may prompt). On success,
		//    persist so future launches skip the prompt entirely.
		cmd := exec.Command(securityBin, "find-generic-password", "-s", ipatoolKeychainService, "-w")
		out, err := cmd.Output()
		if err != nil {
			return
		}
		var raw struct {
			DSID string `json:"directoryServicesIdentifier"`
		}
		if jerr := json.Unmarshal(bytes.TrimSpace(out), &raw); jerr != nil {
			return
		}
		a.cachedDSID = raw.DSID
		if raw.DSID != "" {
			if p := dsidCachePath(); p != "" {
				_ = os.MkdirAll(filepath.Dir(p), 0o755)
				_ = os.WriteFile(p, []byte(raw.DSID), 0o600)
			}
		}
	})
	return a.cachedDSID
}

// InvalidateSignedInDSID clears both the in-memory and on-disk cache so the
// next SignedInDSID() call re-reads from the keychain. Called on sign-in /
// sign-out so the chip colours track the active account.
func (a *App) InvalidateSignedInDSID() {
	a.cachedDSID = ""
	a.dsidOnce = sync.Once{}
	if p := dsidCachePath(); p != "" {
		_ = os.Remove(p)
	}
}

// extractItemID pulls the App Store numeric itemId from an iTunesMetadata.plist
// blob (XML format, as Apple ships it inside IPAs). We avoid plutil here for
// two reasons: (1) plutil's JSON converter rejects <date> elements, which this
// plist contains; (2) we only need one field, so a targeted regex is simpler
// than a full parse. Returns "" if the field isn't present (sideloaded apps).
func extractItemID(plistBytes []byte) string {
	match := itemIDRe.FindSubmatch(plistBytes)
	if len(match) < 2 {
		return ""
	}
	return string(match[1])
}

func (a *App) PickOutputDir() (string, error) {
	return wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose download folder",
	})
}

// PickIPAPath opens a native file dialog filtered to .ipa so the user can point
// the Install button at a downloaded package without typing a path.
func (a *App) PickIPAPath() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Choose the .ipa to install",
		Filters: []wruntime.FileFilter{
			{DisplayName: "iOS App Package (*.ipa)", Pattern: "*.ipa"},
		},
	})
}

func (a *App) DefaultOutputDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, "Downloads")
}

func (a *App) ListVersions(bundleID string) ([]Version, error) {
	if strings.TrimSpace(bundleID) == "" {
		return nil, errors.New("bundle id is required")
	}
	out, errOut, err := a.runIpatool("list-versions", "-b", bundleID)
	line := firstJSON(out)
	if line == nil {
		line = firstJSON(errOut)
	}
	if line == nil {
		return nil, fmt.Errorf("no JSON output: %s", errOrEmpty(err))
	}
	var raw struct {
		ExternalIDs []string `json:"externalVersionIdentifiers"`
		Error       string   `json:"error"`
		Message     string   `json:"message"`
		Success     bool     `json:"success"`
	}
	if jerr := json.Unmarshal(line, &raw); jerr != nil {
		return nil, jerr
	}
	if !raw.Success && len(raw.ExternalIDs) == 0 {
		return nil, errors.New(firstNonEmpty(raw.Error, raw.Message, errOrEmpty(err)))
	}

	// list-versions returns oldest → newest. Reverse so newest comes first,
	// and cap at 25 so the metadata fetch stays snappy.
	ids := raw.ExternalIDs
	n := len(ids)
	rev := make([]string, n)
	for i, id := range ids {
		rev[n-1-i] = id
	}
	const cap = 25
	if len(rev) > cap {
		rev = rev[:cap]
	}

	versions := make([]Version, len(rev))
	sem := make(chan struct{}, 5)
	var wg sync.WaitGroup
	for i, id := range rev {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, id string) {
			defer wg.Done()
			defer func() { <-sem }()
			versions[i] = a.getVersionMetadata(bundleID, id)
		}(i, id)
	}
	wg.Wait()
	return versions, nil
}

func (a *App) getVersionMetadata(bundleID, externalID string) Version {
	out, errOut, _ := a.runIpatool("get-version-metadata", "-b", bundleID, "--external-version-id", externalID)
	line := firstJSON(out)
	if line == nil {
		line = firstJSON(errOut)
	}
	v := Version{ExternalID: externalID}
	if line == nil {
		return v
	}
	var raw struct {
		DisplayVersion string `json:"displayVersion"`
		ReleaseDate    string `json:"releaseDate"`
	}
	_ = json.Unmarshal(line, &raw)
	v.DisplayVersion = raw.DisplayVersion
	v.ReleaseDate = raw.ReleaseDate
	return v
}

func (a *App) Download(bundleID, outputDir, externalVersionID string, purchase bool) DownloadResult {
	if strings.TrimSpace(bundleID) == "" {
		return DownloadResult{Error: "bundle id is required"}
	}
	if outputDir == "" {
		outputDir = a.DefaultOutputDir()
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return DownloadResult{Error: err.Error()}
	}
	suffix := ""
	if v := strings.TrimSpace(externalVersionID); v != "" {
		suffix = "_v" + sanitizeFilename(v)
	}
	outPath := filepath.Join(outputDir, sanitizeFilename(bundleID)+suffix+".ipa")

	expectedSize := lookupAppSize(bundleID) // best-effort; 0 if unknown

	args := []string{"download", "-o", outPath}
	if isAllDigits(bundleID) {
		args = append(args, "-i", bundleID)
	} else {
		args = append(args, "-b", bundleID)
	}
	if v := strings.TrimSpace(externalVersionID); v != "" {
		args = append(args, "--external-version-id", v)
	}
	if purchase {
		args = append(args, "--purchase")
	}

	wruntime.EventsEmit(a.ctx, "download:start", map[string]any{
		"bundleID":    bundleID,
		"output":      outPath,
		"totalBytes":  expectedSize,
	})

	// Poll the output file size in a goroutine and emit progress events.
	var stop atomic.Bool
	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for !stop.Load() {
			<-ticker.C
			if stop.Load() {
				return
			}
			size := currentDownloadSize(outPath)
			wruntime.EventsEmit(a.ctx, "download:progress", map[string]any{
				"bundleID":   bundleID,
				"bytes":      size,
				"totalBytes": expectedSize,
			})
		}
	}()

	out, errOut, err := a.runIpatool(args...)
	stop.Store(true)
	<-doneCh

	line := firstJSON(out)
	if line == nil {
		line = firstJSON(errOut)
	}
	var raw struct {
		Success  bool   `json:"success"`
		Output   string `json:"output"`
		BundleID string `json:"bundleID"`
		Name     string `json:"name"`
		Version  string `json:"version"`
		Error    string `json:"error"`
		Message  string `json:"message"`
	}
	if line != nil {
		_ = json.Unmarshal(line, &raw)
	}

	res := DownloadResult{
		Success:    err == nil,
		OutputPath: firstNonEmpty(raw.Output, outPath),
		BundleID:   firstNonEmpty(raw.BundleID, bundleID),
		Name:       raw.Name,
		Version:    raw.Version,
	}
	if err != nil {
		res.Success = false
		res.Error = firstNonEmpty(raw.Error, raw.Message, err.Error())
	}
	if res.Success {
		// Rename the saved file to the app's display name (e.g. "Groundwire_v8.6.ipa")
		// instead of the bundle ID / numeric App Store ID it was written under.
		// Best-effort: skip if the name can't be read or the target already exists.
		if name := appNameFromIPA(res.OutputPath); name != "" {
			named := filepath.Join(outputDir, sanitizeFilename(name)+suffix+".ipa")
			if named != res.OutputPath {
				if _, statErr := os.Stat(named); os.IsNotExist(statErr) {
					if renameErr := os.Rename(res.OutputPath, named); renameErr == nil {
						res.OutputPath = named
					}
				}
			}
		}
		// Send a final 100% so the bar visibly fills even if polling missed it.
		if fi, statErr := os.Stat(res.OutputPath); statErr == nil {
			final := fi.Size()
			wruntime.EventsEmit(a.ctx, "download:progress", map[string]any{
				"bundleID":   bundleID,
				"bytes":      final,
				"totalBytes": final,
			})
		}
	}
	wruntime.EventsEmit(a.ctx, "download:done", res)
	return res
}

// currentDownloadSize returns the size of the output file or any sibling
// in-progress file (some download flows write to a temp path first).
func currentDownloadSize(outPath string) int64 {
	if fi, err := os.Stat(outPath); err == nil {
		return fi.Size()
	}
	// Fall back to scanning the directory for a file with the same prefix.
	dir := filepath.Dir(outPath)
	base := filepath.Base(outPath)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	var max int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, base) {
			continue
		}
		if info, ierr := e.Info(); ierr == nil && info.Size() > max {
			max = info.Size()
		}
	}
	return max
}

func isAllDigits(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ArtworkRequest pairs an App Store ID with the storefront it was purchased in.
// Region-locked apps (AusPost, Service NSW, etc.) only show up in their home
// storefront, so we have to query the right one per app.
type ArtworkRequest struct {
	ID         string `json:"id"`
	Storefront string `json:"storefront"` // two-letter ISO; defaults to "us" if empty
}

// LookupArtwork batches iTunes lookup calls, grouped by storefront, and
// returns a map of id → artworkUrl100. Delisted apps simply won't appear in
// the response (Apple wipes them from this endpoint), which we surface as an
// empty string so the UI can render a placeholder icon. Best-effort; any
// network or JSON error returns whatever partial map was filled in.
func (a *App) LookupArtwork(reqs []ArtworkRequest) map[string]string {
	out := make(map[string]string, len(reqs))
	if len(reqs) == 0 {
		return out
	}
	// Group IDs by storefront so we make one call per country.
	byCountry := make(map[string][]string)
	for _, r := range reqs {
		country := strings.ToLower(strings.TrimSpace(r.Storefront))
		if country == "" {
			country = "us"
		}
		byCountry[country] = append(byCountry[country], r.ID)
	}
	for country, ids := range byCountry {
		// iTunes lookup supports up to ~200 comma-separated IDs per call;
		// chunk smaller to keep individual responses snappy.
		const chunk = 100
		for i := 0; i < len(ids); i += chunk {
			end := i + chunk
			if end > len(ids) {
				end = len(ids)
			}
			idCSV := strings.Join(ids[i:end], ",")
			u := "https://itunes.apple.com/lookup?id=" + url.QueryEscape(idCSV) + "&entity=software&country=" + url.QueryEscape(country)
			client := &http.Client{Timeout: 6 * time.Second}
			resp, err := client.Get(u)
			if err != nil {
				continue
			}
			body, rerr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
			resp.Body.Close()
			if rerr != nil {
				continue
			}
			var data struct {
				Results []struct {
					TrackID       int64  `json:"trackId"`
					ArtworkURL60  string `json:"artworkUrl60"`
					ArtworkURL100 string `json:"artworkUrl100"`
					ArtworkURL512 string `json:"artworkUrl512"`
				} `json:"results"`
			}
			if jerr := json.Unmarshal(body, &data); jerr != nil {
				continue
			}
			for _, r := range data.Results {
				// Prefer 100x100 (sharp enough at 2x in a 32px row, small to fetch).
				art := r.ArtworkURL100
				if art == "" {
					art = r.ArtworkURL60
				}
				if art == "" {
					art = r.ArtworkURL512
				}
				if art != "" {
					out[strconv.FormatInt(r.TrackID, 10)] = art
				}
			}
		}
	}
	return out
}

// lookupAppSize hits Apple's public iTunes Search lookup endpoint to get the
// IPA's fileSizeBytes. Returns 0 on any failure (best-effort, no auth needed).
// Accepts either a bundle ID or a numeric App ID.
func lookupAppSize(idOrBundle string) int64 {
	param := "bundleId"
	if isAllDigits(idOrBundle) {
		param = "id"
	}
	u := "https://itunes.apple.com/lookup?" + param + "=" + url.QueryEscape(idOrBundle) + "&country=us"
	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return 0
	}
	var data struct {
		Results []struct {
			FileSizeBytes any `json:"fileSizeBytes"`
		} `json:"results"`
	}
	if jerr := json.Unmarshal(body, &data); jerr != nil || len(data.Results) == 0 {
		return 0
	}
	switch v := data.Results[0].FileSizeBytes.(type) {
	case string:
		var n int64
		fmt.Sscanf(v, "%d", &n)
		return n
	case float64:
		return int64(v)
	}
	return 0
}

func sanitizeFilename(s string) string {
	r := strings.NewReplacer("/", "_", ":", "_", " ", "_")
	return r.Replace(s)
}

// itemNameRe pulls the app's human-readable display name ("itemName") out of an
// IPA's iTunesMetadata.plist XML — e.g. "Groundwire" rather than the bundle ID
// or numeric App Store ID. Same XML-only caveat as the other plist regexes, so
// callers must run binary plists through plistToXML first.
var itemNameRe = regexp.MustCompile(`<key>itemName</key>\s*<string>([^<]*)</string>`)

// appNameFromIPA opens a downloaded .ipa (a zip) and returns the app's display
// name from the bundled iTunesMetadata.plist. ipatool writes that plist into
// every download, so this works for bundle-ID and numeric-ID downloads alike.
// Returns "" if the metadata is missing or the name can't be read, in which
// case the caller keeps the bundle-ID-based filename.
func appNameFromIPA(ipaPath string) string {
	zr, err := zip.OpenReader(ipaPath)
	if err != nil {
		return ""
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name != "iTunesMetadata.plist" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return ""
		}
		if m := itemNameRe.FindSubmatch(plistToXML(b)); m != nil {
			return strings.TrimSpace(html.UnescapeString(string(m[1])))
		}
		return ""
	}
	return ""
}

func errOrEmpty(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if v != "" {
			return v
		}
	}
	return ""
}
