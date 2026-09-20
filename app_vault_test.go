package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// testVaultIsolation points every keychain operation at throwaway service names
// and every on-disk path (vault, cookies, DSID cache) at a temp dir, so the
// tests never touch the real ipatool session or the real vault.
func testVaultIsolation(t *testing.T) {
	t.Helper()
	ipatoolKeychainService = "pullapps.test.live"
	ipatoolKeychainAccount = "account"
	vaultKeychainService = "pullapps.test.vault"
	appSupportDirOverride = t.TempDir()
	t.Cleanup(func() {
		_ = exec.Command(securityBin, "delete-generic-password", "-s", "pullapps.test.live", "-a", "account").Run()
		_ = exec.Command(securityBin, "delete-generic-password", "-s", "pullapps.test.vault", "-a", "DSID-ONE").Run()
		_ = exec.Command(securityBin, "delete-generic-password", "-s", "pullapps.test.vault", "-a", "DSID-TWO").Run()
		ipatoolKeychainService = "ipatool-auth.service"
		ipatoolKeychainAccount = "account"
		vaultKeychainService = "pullapps.accounts"
		appSupportDirOverride = ""
	})
}

func accountBlob(t *testing.T, email, name, dsid string) []byte {
	t.Helper()
	b, err := json.Marshal(ipatoolAccount{
		Email:               email,
		Name:                name,
		DirectoryServicesID: dsid,
		PasswordToken:       "token-" + dsid,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

// mountLive writes a blob into the "live" ipatool slot (simulated fresh login).
func mountLive(t *testing.T, blob []byte) {
	t.Helper()
	if err := vaultPutBlob2(ipatoolKeychainService, ipatoolKeychainAccount, blob); err != nil {
		t.Fatalf("mount live: %v", err)
	}
}

// writeLiveCookies seeds ipatool's live cookie jar (as a fresh login would).
func writeLiveCookies(t *testing.T, jar string) {
	t.Helper()
	p := ipatoolCookiesPath()
	if p == "" {
		t.Fatal("no live cookie path")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		t.Fatalf("mkdir cookies: %v", err)
	}
	if err := os.WriteFile(p, []byte(jar), 0o600); err != nil {
		t.Fatalf("write cookies: %v", err)
	}
}

// readLiveCookies returns the current live cookie jar content ("" if absent).
func readLiveCookies(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile(ipatoolCookiesPath())
	if err != nil {
		return ""
	}
	return string(b)
}

func TestVaultRoundTrip(t *testing.T) {
	testVaultIsolation(t)
	a := NewApp()

	// "Sign in" as account ONE (with its cookie jar), then snapshot.
	mountLive(t, accountBlob(t, "one@example.com", "One", "DSID-ONE"))
	writeLiveCookies(t, `{"jar":"one-cookies"}`)
	a.snapshotActive()

	// "Sign in" as account TWO and snapshot that too.
	mountLive(t, accountBlob(t, "two@example.com", "Two", "DSID-TWO"))
	writeLiveCookies(t, `{"jar":"two-cookies"}`)
	a.snapshotActive()

	list := a.ListAccounts()
	if !list.SignedIn {
		t.Fatalf("expected SignedIn=true, got %v", list.SignedIn)
	}
	if len(list.Accounts) != 2 {
		t.Fatalf("expected 2 accounts, got %d: %+v", len(list.Accounts), list.Accounts)
	}
	if list.Active != 0 {
		t.Fatalf("expected activeIndex=0, got %d", list.Active)
	}
	if list.Accounts[0].DSID != "DSID-TWO" || list.Accounts[0].Email != "two@example.com" {
		t.Fatalf("expected active DSID-TWO first with email, got %+v", list.Accounts[0])
	}

	// Switch to ONE (the remembered account from earlier): the live slot must
	// now hold ONE's blob and ONE's cookies.
	if err := a.SwitchAccount("DSID-ONE"); err != nil {
		t.Fatalf("SwitchAccount: %v", err)
	}
	live, err := readActiveBlob()
	if err != nil {
		t.Fatalf("readActiveBlob: %v", err)
	}
	if !bytes.Equal(bytes.TrimSpace(live), accountBlob(t, "one@example.com", "One", "DSID-ONE")) {
		t.Fatalf("live slot mismatch after switch: %s", live)
	}
	if got := readLiveCookies(t); got != `{"jar":"one-cookies"}` {
		t.Fatalf("live cookies mismatch after switch: %q", got)
	}

	// After the switch, ONE is active; TWO is still remembered.
	list = a.ListAccounts()
	if list.Active != 0 || len(list.Accounts) != 2 || list.Accounts[0].DSID != "DSID-ONE" {
		t.Fatalf("unexpected list after switch: %+v (active=%d)", list.Accounts, list.Active)
	}

	// Switch away and back repeatedly — every switch re-snapshots the active
	// account, so no session is ever lost.
	if err := a.SwitchAccount("DSID-TWO"); err != nil {
		t.Fatalf("SwitchAccount(TWO): %v", err)
	}
	if err := a.SwitchAccount("DSID-ONE"); err != nil {
		t.Fatalf("SwitchAccount(ONE) again: %v", err)
	}
	if got := readLiveCookies(t); got != `{"jar":"one-cookies"}` {
		t.Fatalf("live cookies lost after switch round trip: %q", got)
	}

	// Remove the non-active account — it must vanish from vault + list.
	if err := a.RemoveAccount("DSID-TWO"); err != nil {
		t.Fatalf("RemoveAccount: %v", err)
	}
	list = a.ListAccounts()
	if len(list.Accounts) != 1 || list.Accounts[0].DSID != "DSID-ONE" {
		t.Fatalf("expected only DSID-ONE after remove, got %+v", list.Accounts)
	}
	if _, err := vaultGetBlob("DSID-TWO"); err == nil {
		t.Fatal("expected DSID-TWO blob to be gone after RemoveAccount")
	}
	if _, err := os.Stat(a.vaultCookiesPath("DSID-TWO")); !os.IsNotExist(err) {
		t.Fatalf("expected DSID-TWO cookie dir removed, stat err=%v", err)
	}

	// Removing the active account: live session stays mounted, but the vault
	// platform no longer keeps the manifest row (ListAccounts still surfaces the
	// live session as the only option).
	if err := a.RemoveAccount("DSID-ONE"); err != nil {
		t.Fatalf("RemoveAccount(active): %v", err)
	}
	list = a.ListAccounts()
	if len(list.Accounts) != 1 || list.Accounts[0].DSID != "DSID-ONE" {
		t.Fatalf("expected active session still listed, got %+v", list.Accounts)
	}
}

// TestVaultEmailKeyedAccount covers accounts whose blob carries no DSID — the
// vault must fall back to the email as its key everywhere.
func TestVaultEmailKeyedAccount(t *testing.T) {
	testVaultIsolation(t)
	a := NewApp()

	mountLive(t, accountBlob(t, "nodsid@example.com", "No Dsid", ""))
	a.snapshotActive()

	list := a.ListAccounts()
	if !list.SignedIn || len(list.Accounts) != 1 {
		t.Fatalf("expected one active email-keyed account, got %+v (signedIn=%v)", list.Accounts, list.SignedIn)
	}
	if list.Accounts[0].DSID != "nodsid@example.com" {
		t.Fatalf("expected email to be the vault key, got %+v", list.Accounts[0])
	}
	blob, err := vaultGetBlob("nodsid@example.com")
	if err != nil {
		t.Fatalf("expected blob under email key: %v", err)
	}
	acc, ok := parseIpatoolAccount(blob)
	if !ok || acc.Email != "nodsid@example.com" {
		t.Fatalf("round-tripped blob mismatch: %+v", acc)
	}
}

func TestListAccountsEmptyWhenNoSession(t *testing.T) {
	testVaultIsolation(t)
	a := NewApp()
	list := a.ListAccounts()
	if list.SignedIn {
		t.Fatal("expected SignedIn=false without a live session")
	}
	if len(list.Accounts) != 0 {
		t.Fatalf("expected no accounts, got %+v", list.Accounts)
	}
}

func TestNormalizeIpatoolBlob(t *testing.T) {
	raw := []byte(`{"email":"x@example.com","directoryServicesIdentifier":"123"}`)
	hexEnc := []byte("7b22656d61696c223a2278406578616d706c652e636f6d222c226469726563746f727953657276696365734964656e746966696572223a22313233227d")
	if got := normalizeIpatoolBlob(raw); !bytes.Equal(got, raw) {
		t.Fatalf("raw json must pass through, got %q", got)
	}
	if got := normalizeIpatoolBlob(hexEnc); !bytes.Equal(got, raw) {
		t.Fatalf("expected hex decoded to raw, got %q", got)
	}
	if got := normalizeIpatoolBlob(append([]byte("  \n"), hexEnc...)); !bytes.Equal(got, raw) {
		t.Fatalf("expected whitespace-padded hex decoded, got %q", got)
	}
	if got := normalizeIpatoolBlob([]byte("hello")); string(got) != "hello" {
		t.Fatalf("non-hex must stay, got %q", got)
	}
	if got := normalizeIpatoolBlob([]byte("7b2")); string(got) != "7b2" {
		t.Fatalf("odd-length must stay, got %q", got)
	}
	if got := normalizeIpatoolBlob(nil); len(got) != 0 {
		t.Fatalf("empty must stay, got %q", got)
	}
}

func TestIsHexForm(t *testing.T) {
	if !isHexForm([]byte("7b2265")) {
		t.Fatal("expected hex detected")
	}
	if isHexForm([]byte("7b226")) {
		t.Fatal("odd length must not be hex")
	}
	if isHexForm([]byte("zzzz")) {
		t.Fatal("non-hex chars must not be hex")
	}
	if isHexForm(nil) || isHexForm([]byte("")) {
		t.Fatal("empty must not be hex")
	}
}
