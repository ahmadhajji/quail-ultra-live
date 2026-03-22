Quail Ultra
Late Beta 0.9.0-beta.1

macOS first launch:

This build is currently unsigned. macOS may block the first launch.

Recommended path:
1. Move Quail Ultra.app into Applications.
2. Open Applications in Finder.
3. Right-click Quail Ultra.app and choose Open.
4. Click Open again in the warning dialog.

If macOS still blocks the app:
1. Open System Settings.
2. Go to Privacy & Security.
3. Scroll down to the security section.
4. Click Open Anyway for Quail Ultra.

If macOS says "Quail Ultra.app" is damaged and can't be opened, that is usually the quarantine check on an unsigned app, not actual file corruption.

Terminal fallback:
xattr -dr com.apple.quarantine "/Applications/Quail Ultra.app"

Windows note:

The Windows build is currently Alpha and not hardware-tested before release.
If you use the Windows installer, treat it as preview quality.

Release page:
https://github.com/ahmadhajji/quail-ultra/releases
