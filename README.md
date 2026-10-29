# People

An interactive people directory. Each person is a card in a grid; clicking one opens their photo, labels and social links in a right-hand panel. Everything runs in the browser on localhost and is stored in IndexedDB. Photos are kept as references to where they already live, never copied.

Requirements: [People Portfolio Website — Requirements Document](https://claude.ai/code/artifact/e1946dd7-7973-44c3-9555-3d0b7a9f7b5f)

## Run

```bash
npm install
npm run dev     # http://localhost:5173 (port is fixed: it's the Google OAuth origin for Phase 2)
npm run build
```

Use Chrome or Edge for local folders (File System Access API). Other browsers fall back to **Upload file**, which copies the image into browser storage.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Grid, panel, add/edit/delete, labels with groups, search + filters, JSON export/import, local-folder photos | Done |
| 2 | Google Drive source (sign-in, in-app Drive browser, find folder by person name), missing-photo checks | Done |
| 3 | Label merge, bulk add/label, arrow-key nav, prev/next, view-only mode, theme toggle, photo lightbox | Done |
| 4 (v2) | Personal server source + storage | Later |

Also included in Phase 1: sort, filters in the URL, undo toasts, a 30-day backup reminder, and **⋮ → Add 500 sample people** for trying it out.

## Google Drive

Setup: a Google Cloud OAuth **Web** client with `http://localhost:5173` as an authorised JavaScript origin, the Drive API enabled, and you as a test user. Put the Client ID in `.env.local` (see `.env.example`) and restart `npm run dev`. No API key is needed: the app browses Drive itself instead of using Google Picker.

- Sign-in is read-only (`drive.readonly`). The token is kept in memory only, so each new browser session needs one click on **Continue as …** (the banner at the top). Cached thumbnails show without signing in.
- In the photo picker, the Drive tab searches for a folder named like the person first. Name each person's folder after them.
- **⋮ → Check for missing photos** asks Drive and your local folders whether each photo still exists, then filters to the missing ones.

## Everyday use

- **Bulk add** (⋮ → Bulk add from a folder): pick a local or Drive folder, then make one person per subfolder (folder name + its first photo) or one per photo (file name). Names already in the directory are skipped unless you untick that.
- **Select people** (⋮): click cards to tick them, Shift-click for a range, then add or remove a label, or delete. Everything can be undone from the toast.
- **Manage labels**: "Merge into…" moves everyone from one label to another and deletes the first.
- **Keyboard**: arrows move between cards, Enter opens, ← → step through people while the panel is open, / searches, Esc closes, ? lists shortcuts.
- **View-only mode** (⋮) hides every control that changes data on this browser. **Theme**: System, Light or Dark (⋮).
- **Sort by photos**: Most photos / Fewest photos, plus a Photos filter (any / has photos / no photos). A linked folder's size is known once it has been read; "Count now" (or Check for missing photos) reads the rest, and counts are remembered.
- **Right panel**: drag its left edge to resize (arrow keys work on the edge too; double-click resets; the width is remembered). Hover a photo in a person's photo view and click the wallpaper button (or **Set background** in the full-size view) to make it that person's panel background; the button again, or the remove-background icon in the panel, clears it. Links show as icons; hover for the address, click to open.
- **Pin** a person (📌 on the card, or Pin in the panel) to keep them at the top whatever the sort or filter; Keep pins come across on import.
- **Mark** photos (bookmark button on a photo, or M in the full-size view). Marked photos appear small at the bottom of the right panel, filling from the bottom up; click one to open it, × to unmark.
- Animations: choose a style in the menu under Animation: Simple, Spring (default), Flip, Zoom or Reveal. They cover opening and closing a person and a photo, and follow the system reduce-motion setting.
- **Several photos per person** (Edit → Photos): **Add photos** lets you tick any number in a folder, or **Add all** in it. **Link a folder** shows everything in the person's Drive or local folder, including photos added later. The cover (star) is what the card shows. Click a card and the main area shows all of that person's photos while the right-hand panel shows their details (on phones both are in one sheet). Hover a photo and click ★ to make it the cover straight away (with Undo); − / + resize the photo grid. Click a photo for full size: ← → step through, zoom with + / −, the mouse wheel or a double-click, drag to move around, 0 to fit, and "Make cover" works there too. A photo that can't be shown says why: not found, sign in, format not supported (e.g. HEIC in Chrome), or couldn't load.

## Importing from Google Keep

**⋮ → Import from Google Keep** reads a Google Takeout export of Keep (a copy; Keep isn't changed). One note becomes one person: the title is the name (or the first line, if untitled), attached images become photos, links become social links, other text becomes notes, and Keep labels become labels. Trashed notes are skipped. Photos are used from the export folder, so keep that folder after importing. Needs Chrome or Edge.

To import again later, unzip the new export into the **same** folder. People already here get new photos (matched by file name), links, labels, note lines and pins added; nothing is duplicated, and Undo reverts it.

**Copy to Google Keep** (sticky-note icon in a person's panel): Keep has no API for personal accounts, so this prepares a note to paste: the title and text (nationality, age, labels, links, notes) with Copy buttons, and up to 49 chosen photos saved to a folder named after the person, to drag into the note.

## Backups and disks

- **⋮ → Automatic backup**: choose a folder (ideally another disk or a synced folder) and how often; the export file is written there and the newest few are kept. If Chrome needs a click to write again, a banner offers **Back up now**. Restore with **⋮ → Import JSON**.
- An **unplugged external disk** shows its photos as "Disk not connected" (never "missing") with a banner; they come back by themselves within ~15 s of reconnecting.

## Layout

- `src/photos/PhotoSource.ts`: the interface every photo source implements: `localSource.ts`, `driveSource.ts` (sign-in in `driveAuth.ts`). `index.ts` registers sources and owns the thumbnail cache (IndexedDB, about 300 px WEBP).
- `src/db.ts`: Dexie schema (people, labels, groups, folders, blobs, thumbs, meta).
- `src/lib/`: store actions, filters + URL sync, export/import validation, social-link helpers, sample data.
- `src/components/`: virtualised grid, detail panel, autosaving editor, photo picker, label input/manager.

## Labels

Type `Group: Label` (for example `City: Udupi`) to create a label inside a group. Groups and labels are only created by you. Rename, recolour, regroup or delete them under **⋮ → Manage labels**.

## Notes

- Export files hold photo *references*. A photo added with **Upload file** lives only in this browser's storage and isn't in the export.
- After a browser restart, Chrome asks you to re-grant folder access (banner at the top). Cached thumbnails still show until you do.
