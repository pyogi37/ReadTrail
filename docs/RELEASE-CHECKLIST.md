# Release Checklist

Run top to bottom for every store submission. Publishing itself is the owner's click.

## 1. Code

- [ ] `docs/STATUS.md` says the release phases are complete and reviewed.
- [ ] Bump `version` in `manifest.json` and `package.json` (they must match).
- [ ] Move the `[Unreleased]` notes in `CHANGELOG.md` under the new version with today's date.
- [ ] `npm test` is green.
- [ ] `git diff --check` is clean.
- [ ] `npm run package:check` passes.
- [ ] `npm run package` writes `dist/readtrail-<version>.zip`.

## 2. Manual verification

- [ ] Load `dist/readtrail-<version>.zip` by dragging it onto `chrome://extensions` in a fresh profile (Developer mode on).
- [ ] Run `docs/qa/MANUAL-QA.md` and log the run in `docs/qa/runs/<date>-<version>.md`. Every case passes or has an approved exception.
- [ ] The extension service-worker console shows no errors on install, on update (reload), and after a Chrome restart.

## 3. Store materials

- [ ] `PRIVACY.md` matches the behavior of this version; `docs/privacy-policy.md` is identical; GitHub Pages serves it at the URL in `docs/store/LISTING.md`.
- [ ] `docs/store/PERMISSIONS.md` matches `manifest.json` permissions exactly.
- [ ] Screenshots per `docs/store/SCREENSHOTS.md` exist at 1280 x 800.
- [ ] Listing copy in `docs/store/LISTING.md` is approved by the owner.

## 4. Dashboard

- [ ] Upload the zip as a new version.
- [ ] Store listing: name, summary, description, category, screenshots, promo tile.
- [ ] Privacy practices: single purpose, permission justifications, data usage disclosure, certifications, privacy policy URL.
- [ ] Distribution: public, all regions.
- [ ] Submit for review (owner).

## 5. After submission

- [ ] Tag the commit: `git tag v<version>` and push the tag.
- [ ] Record the submission date and review outcome in `docs/STATUS.md`.
- [ ] Update the README badge and store link once live.
