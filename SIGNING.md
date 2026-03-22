# Signing Requirements

Quail Ultra can be packaged without signing, but actual end-user distribution should use platform signing.

## Current State

- macOS signing is not configured on this machine
- `security find-identity -v -p codesigning` currently returns `0 valid identities found`
- no Apple notarization credentials are configured in the environment
- no Windows code-signing certificate credentials are configured in the environment

## What Is Required For macOS

To produce a proper public macOS distribution build, you need:

- an Apple Developer account
- a `Developer ID Application` certificate installed in the build machine keychain
- notarization credentials

Typical notarization credential options:

- App Store Connect API key
- Apple ID + app-specific password + team ID

Without these, the app can still be built as an unsigned `.app`, `.zip`, or `.dmg`, but Gatekeeper warnings will remain and notarization cannot be completed.

## What Is Required For Windows

To produce a properly signed Windows installer, you need:

- an Authenticode code-signing certificate, usually in `.pfx` form, or a cloud-signing provider
- the certificate password or signing-service credentials

Without these, the app can still be built as an unsigned `.exe` installer or `.zip`, but SmartScreen reputation warnings may appear.

## Repo Support

The repo now builds installer artifacts:

- macOS Apple Silicon: `.dmg` and `.zip`
- Windows x64: `.exe` installer and `.zip`

Signing is blocked only by missing credentials, not by missing build targets.
