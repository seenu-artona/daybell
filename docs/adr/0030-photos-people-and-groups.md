# 0030 — Photos: People and Groups

- Status: Proposed with UI round 6 (branch `ui/round6-photos`, stacked on `ui/round5-job-pages`). Every call under
  "Calls for Seenu" is provisional until Seenu reviews it (CLAUDE.md rule 7: nothing decided is changed silently).
- Decisions implemented: D156 (Job › Photos: People and Groups), with Seenu's answers of Oct 14, 2026 (below).
- Decisions touched: D32 and F16 (QR tagging), D60 (what parents see), D96 (studio separation, events, words in files),
  D113 (Montréal; ids only in addresses, events and jobs), D91, D92, D147 and D148 (chips; "ordered"), D151 (the tab
  row), D153 (Subjects).
- Amends: 0016 (an upload batch has a kind and may name a photo group), 0018 (class photo sets become group photos;
  the review moves into Photos' To review; albums and No photos yet leave Photos), 0022 (parents see group photos
  through group membership, not their class), 0026 (Photos' chips: All, To review and "+ Add filter › Group…"; Subjects
  gains a Group chip).

## Seenu's answers (Oct 14, 2026)

These override the architect's plan where they differ.

- **C1 Classes stay.** The class list stays as it is (`job_groups`, `children.group_id`, rename, import, the QR card's
  text, class chips in Subjects' "+ Add filter"). A class only loses its photo meaning.
- **C2 Existing class photos get no groups.** Photos uploaded or moved into a class's Class photo set become group
  photos in no group. Parents stop seeing them until the studio puts them in a group. Nothing is backfilled (no groups,
  no members). They are findable from the Groups list (call 1).
- **C3 Groups from a column:** any roster column; a value whose name is already a group is skipped; blank values make
  no group.
- **C4 Deleting a group with photos:** its photos go to another group or to the bin. Sold photos can't be binned, so
  they must go to a group (refused with `groups.photoSold` otherwise).
- **C5 Selling group photos is the Shop round.** This round parents see group photos through their child's
  membership; the database still refuses them as a pose. D156's "every member can buy them" lands with the Shop round.
- **C6 Naming.** Classes are called classes in the API now: `/jobs/{id}/classes`, `/classes/{id}`, `Child.class`, the
  `Class` type. "Groups" means photo groups everywhere: `/jobs/{id}/groups`, `/groups/{id}`.
- **C13** "Give to a person" is also in the open photo's panel (the same action as To review's).
- **C15** People lists everyone with photos, by last name; people with no photos are not listed; their first card
  photo leads their line.

## Naming map

| Word on screen and in the API | Database |
|---|---|
| Class (`Class`, `/classes/{id}`, `Child.class`, `classId`) | `job_groups`, `children.group_id` (unchanged) |
| Group (`PhotoGroup`, `/groups/{id}`, `RosterChild.groups`, `groupId`) | `photo_groups`, `photo_group_members`, `photo_group_photos` |
| Group photo (`groupPhoto`) | `photo_place` `group_photo` (was `class_set`) |

## What changed

**Data** (`20261016000000_photo_groups.sql`, forward only).

- `photo_groups` (`studio_id`, `job_id`, name 1–60 trimmed, unique per job ignoring case), `photo_group_members`
  (group, child; a person can be in several groups) and `photo_group_photos` (group, photo; a photo can be shown in
  several groups). Composite studio and job keys (ADR 0008); members follow their child and group out (cascade); a
  group with photos can't be deleted without moving them (restrict); a purged photo leaves its groups. Row-level
  security: members read; nobody signed in writes. Indexes on `studio_id`, the child and the photo.
- `photo_place` `class_set` is renamed `group_photo`; `photo_tags.group_id` is dropped (a group photo's groups are its
  links). Every function whose body named `class_set` or the dropped column is recreated in the same migration; pgTAP
  checks no function body in `public` or `app` still says `class_set`.
- `upload_batches.kind` (`individual` | `group`), `photo_group_id` (a group upload's group) and `add_to_group_id` (an
  individual upload's "add everyone to this group"), both `on delete set null`; a check ties each to its kind.
  `upload_batches.group_id` is dropped; existing class-photo batches become `kind = 'group'` with no group (C2).
- **Group photos are linked once, when their files are registered** (`register_photos`, new photos only, never a
  resumed one), and never by tagging. `photos.uploaded` gains `kind` and `photo_group_id`; the links write no event of
  their own (C12).
- **Tagging keys on the batch's kind**: a group upload's photos are all group photos (cards in it hidden, unreadable
  ones flagged, as class photos were). `apply_batch_tags` adds each person a run places photos with to the upload's
  `add_to_group_id` (add only; C7).
- **What parents see** (`app.parent_visible_photos(job, child, group_photos)` and its twin `photo_parent_visible`):
  a child's portraits as before, and with `group_photos` the group photos linked to any group the child is a member
  of, once each, in tagging order. A group photo in no group, or only in groups with no members, is seen by no one.
  `shop_gallery` returns `group_photos`. A group photo is still refused as a pose (C5).
- Reads (SECURITY INVOKER): `photo_people(job, group, after, limit ≤ 51, strip ≤ 50)` (people with photos by last name,
  each with their photo count and a strip led by their first card photo), `list_photo_groups(job)` (members, group
  photos, Ordered for owners and admins only, and the count of group photos in no group),
  `list_photo_group_members(group, after, limit)`, `photo_group_photos_page(job, group or none, after, limit)`;
  `list_children` gains each child's `photo_groups`; `job_tagging_overview` loses `albums`, `no_group` and `no_photos`;
  `tagging_children` and `tagging_no_photos` are dropped (C17). `save_list_filters` takes `group` (a group of this job)
  for `job_photos` and `job_subjects`.
- Writes (service role only, acting for the person: owners, admins and photographers; staff and other studios get
  42501; closed jobs `job_closed`; at most 500 ids; errors carry no values): `create_photo_group`, `rename_photo_group`,
  `delete_photo_group(group, photos_to, target)`, `make_photo_groups_from_column(job, column)`,
  `set_photo_group_members(group, add, remove)`, `move_group_photos(job, from or none, to, photos)`,
  `also_show_photos(job, photos, groups)`. Group writes of a job take turns on an advisory lock (`photo_groups:<job>`).
- Events (ids and counts only): `photo_group.created {job_id, source}`, `.updated {fields}`, `.deleted {job_id,
  photos_to, target_group_id}`, `.members_changed {added, removed, count}`, `.photos_moved {photo_ids, from, to}`,
  `.photos_shown {photo_ids, group_ids}`, `photo_groups.made_from_column {job_id, column, groups, members}`. Not in the
  activity log yet.
- **Nothing moves people or group photos by itself:** no upload, roster change, new group or tagging run changes a
  group's photos, and none removes a member (pgTAP proves each).

**API** (`/api/v1`, D92). Classes: `GET`/`POST /jobs/{id}/classes`, `PATCH /classes/{id}`; `Child.class`; inputs
`classId`, `classIds` (QR cards), `class` (import rows); `GET /jobs/{id}/children?classId=`. Groups:
`GET /jobs/{id}/photos/people?groupId=&cursor=&limit=`; `GET`/`POST /jobs/{id}/groups`;
`POST /jobs/{id}/groups/from-column {column}`; `GET`/`PATCH`/`DELETE /groups/{id}` (`DELETE ?photosTo=group|bin&targetId=`);
`GET`/`POST /groups/{id}/members`; `GET /groups/{id}/photos`; `POST /groups/{id}/photos/move {photoIds, toGroupId}`;
`GET /jobs/{id}/groups/none/photos` and `POST /jobs/{id}/groups/none/photos/move`; `POST /jobs/{id}/photos/also-show
{photoIds, groupIds}`; `POST /jobs/{id}/upload-batches {kind: "individual", addToGroupId?} | {kind: "group", groupId}`
(an empty body is an individual upload). `/photos/move` loses `classSet`; `RosterChild` gains `groups`;
`LIST_FILTER_KEYS` gains `group` for `job_photos` and `job_subjects`; `GET /photos/{id}` gains `tagging` (the photo's
place, flag and what review allows) for the panel. Conflicts: `groups.nameTaken`, `groups.limit`, `groups.photoSold`,
`groups.jobClosed`, `groups.notInJob`, `groups.hasPhotos`, `tagging.groupPhoto`. Every new route runs in Montréal for
Canadian studios (`preferredRegion = "yul1"`, `assertFunctionRegion`; `assertStorageRegion` where previews are signed),
checks the person and their role before reading a body, and answers 404 for another studio's or job's ids.

**Screens.**

- Photos: a People | Groups switch (two links with `aria-current`) at the left of the card's toolbar; the tab row keeps
  a quiet Bin (n) and a white Upload photos (D151).
- People: one folded line per person (their name links to their Subjects record; the first card photo leads with a
  primary-token outline, a QR icon and the words "QR card"; then their photos in shot order; Show all with
  `aria-expanded`), 50 people at a time with Show more. Chips All, To review, "+ Add filter › Group…" (saved).
- To review: Flagged, Leftovers and New people from blank cards (moved from the old Review page), with Give to a
  person, It's a card photo, Looks right, Move to bin and Mark reviewed.
- Groups: Not in a group (n) first, then each group (Group, Members linking to Subjects filtered by the group, Group
  photos, Ordered for owners and admins, ⋯ Rename, Add or remove people, Delete); Make groups from a column and
  + New group. A group's page: back, its name, Upload group photos, ⋯; its photos with a selection bar (Move to group,
  Also show in…, Move to bin); "N members · See them in Subjects" and Add or remove people.
- The upload sheet: Individual photos (and optionally "Add everyone in this upload to a group") or Group photos (a group
  select, set when opened from a group's page), and Soon rows (C14).
- The photo panel: + Give to a person, and Soon rows for main photo, hide, rating, versions, composites, send for
  editing and download original.
- Subjects: a Groups column, the person's groups in their record, and a saved Group chip (`?group=<id>`). Class stays
  a roster column.
- The parent shop's second set is "Group photos".

## Calls for Seenu

Defaults Seenu asked to be listed (rule 7):

- **C7** "Add everyone in this upload to a group" is applied as tagging places photos with each person, add only. It
  isn't applied when a blank card's person is named later, nor by Give to a person.
- **C8** No turning a person's photo into a group photo, or a group photo into a person's, this round: Give to a
  person, drag and Move refuse group photos (`tagging.groupPhoto`); a flagged group photo is confirmed or marked a card
  photo.
- **C9** "Looks right" isn't offered on Leftovers: they are given to someone or binned (today's rule).
- **C10** Group names are unique per job ignoring case, 1–60 characters trimmed; at most 500 groups per job and 500 ids
  per change.
- **C11** Owners, admins and photographers change groups; staff look; closed jobs refuse changes.
- **C12** Group links written when photos are registered have no event of their own: `photos.uploaded` names the kind
  and the group.
- **C14** Soon upload tools: Desktop uploader, FTP, Lightroom, A folder per group.
- **C16** Groups' Ordered is the number of paid orders holding any of the group's photos; photographers and staff don't
  see it (as orders). It is 0 until the Shop round sells group photos.
- **C17** Class albums and No photos yet leave Photos (Subjects' Not photographed covers them).

Calls made in this round:

1. **Not in a group (C2).** When some group photos are in no group, the Groups list starts with a "Not in a group (n)"
   row. It opens a page of those photos with Move to group, Also show in… and Move to bin (no members, no upload).
2. **What a group photo is:** a photo from a group upload, or a photo that was in a class's Class photo set. A card
   photo inside a group upload stays a card photo (hidden from parents, shown with its person) and isn't listed or
   counted on the group's page.
3. **Deleting a group:** a group with no photos is deleted at once (no destination asked); one with photos needs a
   destination (`groups.hasPhotos` otherwise). "Move them to another group" adds them to that group. "Move them to the
   bin" bins only the photos in no other group; photos also shown in another group just leave this one. If any photo to
   bin has sold, nothing changes (`groups.photoSold`). Members simply leave with the group.
4. **Undoing "This is a card photo" on a photo from a group upload** puts it back among the group photos (flagged), not
   in Leftovers, so it can't become a person's photo (C8).
5. **Two endpoints retired:** `GET /jobs/{id}/tagging/children` and `GET /jobs/{id}/tagging/no-photos` (and their
   database functions) served the class albums and No photos yet (C17); `TaggingSummary` loses `albums` and `noPhotos`.
6. **The old Review address** `/app/jobs/{id}/photos/review` now opens Photos with the To review chip
   (`?show=review`); the checklist's Review tagging task and the bell link there.
7. **Other card photos** (card photos linked to no card) stay listed at the end of To review, not blocking Mark
   reviewed, so owners and admins can still undo a card photo mark there.
8. **Mark reviewed** sits on To review's own heading line, with the reason it is disabled in words, not in the tab row.
9. **Make groups from a column** offers Class and Grade: the roster has no Teacher, Team or custom columns yet. A
   group takes the value as its name ("4B", "3"). Values are compared ignoring case. All new groups and members land
   at once or none (the 500-group limit is checked first).
10. **A tagging run that adds people to the upload's group** (C7) writes one `photo_group.members_changed` event,
    attributed to whoever started the upload.
11. **Classes are renamed in the API's inputs too** (`classId`, `classIds`, an import row's `class`, the
    `validation.class*` messages), so "group" never means a class in the API. The roster's word for a class on senior
    and mini-session jobs is still "Group" (unchanged; it now sits beside the Groups column). Question for Seenu: call
    it "Class" there too?
12. **The panel's Give to a person** needs to know what review allows for the photo, so `GET /photos/{id}` returns its
    place, flag and actions (`tagging`, null before it is tagged).
13. **A person's line** shows 12 photos (card photos included, the first card photo first); Show all loads the rest in
    pages of 500. People with only card photos are listed too (a card photo is a photo).
14. **Groups are listed by name** (natural order, as classes). The Groups list loads every group (at most 500).
15. **Add or remove people** lists the roster (up to 5,000, as Subjects) with a search and a tick box each; saving
    sends what changed in batches of 500.
16. **Also show in…** adds the photos to the ticked groups; groups already showing a photo are skipped. Move to group
    on the Not in a group page puts them in one group.
17. **The flat "All photos" grid is gone**: People shows every person's photos and Groups every group photo. The bin
    keeps its own grid. Photos still being processed show in their person's line once tagged.
18. **Group photos in the parent shop** are labelled "Group photos". A child sees the group photos of every group they
    are in, even with a Do not publish groupmate (ADR 0022 call 6's question now applies to groups).
19. **The Groups and group pages are read-only for staff and on closed jobs** (actions hidden), as Subjects is.
20. **Upload group photos** needs at least one group: without one the sheet says to make a group first.
21. **The bin** is Photos with `?bin=1` (no chips shown), reached from Bin (n) in the tab row as before.
22. **The Groups page's tab row** has only Upload photos (no Bin (n)): the bin is People's.
23. **People's footer** says "N of M people with photos", with Show more people when there are more than 50.
24. **To review lists Flagged and Leftovers only when they hold photos**, and says "Nothing to review" when tagging is
    clean, so an empty review isn't a page of empty boxes.
25. **The panel's image alt text** is where the photo was opened from ("Maya Johnson, photo 3"), never its file name;
    opened from an address alone it is "The photo".
26. **Photos on a person's line can be ticked** (Give to a person, Looks right, card photo, bin) as on To review; the
    first card photo and other read card photos can't.
27. **C9 lives in core** (`reviewActions`): a Leftover's `confirm` is false, so every screen and the API agree.
28. **A binned photo's detail** has `tagging: null` (no Give to a person from the bin).
29. **Seniors and other non-school jobs** still say "Group" for the class field (D137's word), so their Subjects can show
    a "Group" column (the class) beside "Groups" (photo groups). Should non-school jobs' class field get another word?
30. **Deleting a group whose photos go to the bin** tags the job's due uploads again before answering, as binning does,
    so To review's counts are right when the dialog closes.
31. **Subjects' Group chip** (`?group=<id>`, saved as `group`) lists the group's members; a group that is deleted is
    dropped from the saved chips, as a class is.

## Not in this round (deferred)

Selling group photos (C5, the Shop round); main photo, hide, rating, versions, composites, send for editing and
download original (Soon); Desktop uploader, FTP, Lightroom, A folder per group (Soon); showing the new events in the
activity log.

## Tests

pgTAP: new `029_photo_groups` (row-level security and grants, studio and job leaks, links written only at
registration, roster imports, new groups and tagging runs never changing links or members, add-to-group add only,
delete to a group or the bin and sold photos refused, from a column, events with ids only, the C2 migration: class-set
photos become group photos in no group that parents can't see, no `class_set` left in any function body); updated
`012`, `021`, `022`, `026` and `007`. Core (tagging with group uploads, group rules, the Group filter), API contracts,
route tests with cross-studio and cross-job leak tests, role and region tests and a console spy for names, the shop's
`groupPhotos`. e2e: rewritten `phase1-tagging` (To review, People, a group upload), updated `phase1-photos`,
`phase1-roster`, `phase1-roster-load`, `phase1-qr-cards`, `phase1-going-live`, `shop-gallery` and the helpers, new
`phase1-photo-groups` (with its cross-studio checks). The e2e specs could not be run in this environment.

## Rejected

- Groups kept in step with a roster column (D156: a shortcut, not a switch).
- Linking group photos in tagging (a retag would move them; D156: nothing moves them by itself).
- Backfilling groups from classes (C2).
