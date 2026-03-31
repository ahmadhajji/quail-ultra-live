# Changelog

## 0.9.0-beta.1

Late beta release of Quail Ultra.

### Added

- Quail Ultra app identity, icon pipeline, and separate app storage path
- Tutor, Timed, and Untimed study modes in the block builder
- continuous question -> answer -> explanation workflow
- persisted question states, eliminate controls, and multicolor highlighting
- Apple Silicon manual packaging script
- GitHub Actions workflow for macOS and Windows release builds

### Changed

- refactored the exam UI toward a simpler UWorld-style desktop layout
- updated overview, previous blocks, and builder surfaces
- normalized legacy progress records for backward compatibility
- replaced stale upstream release/docs clutter with Quail Ultra release-facing docs

### Compatibility

- existing Quail qbank folder format remains supported
- older progress files are normalized on load
- Quail Ultra uses a separate bundle ID and user-data path so it can coexist with original Quail on the same machine

### Platform Notes

- macOS Apple Silicon is the primary tested target for this release
- Windows builds are published as `Alpha` artifacts and are not hardware-tested before release
