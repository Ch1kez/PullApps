package main

import "testing"

func TestValidAccountKeyRejectsPathTraversal(t *testing.T) {
	invalid := []string{"", ".", "..", "../other", "a/b", "a\\b", "line\nbreak"}
	for _, key := range invalid {
		if validAccountKey(key) {
			t.Errorf("validAccountKey(%q) = true; want false", key)
		}
	}

	valid := []string{"8468790598", "person@example.com", "name+tag@example.com"}
	for _, key := range valid {
		if !validAccountKey(key) {
			t.Errorf("validAccountKey(%q) = false; want true", key)
		}
	}
}

func TestVaultCookiesPathStaysInsideVault(t *testing.T) {
	testVaultIsolation(t)
	a := NewApp()
	if got := a.vaultCookiesPath(".."); got != "" {
		t.Fatalf("unsafe key produced vault path %q", got)
	}
}
