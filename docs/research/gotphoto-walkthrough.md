# GotPhoto walkthrough notes

Research notes only, not decisions. Anything here that Silverback adopts needs a D-number first (CLAUDE.md rule 2 and rule 7).

Sources, collected Oct 14, 2026:
- GotPhoto's own onboarding demo video ("photographer's admin area"), transcript supplied by Seenu.
- Seenu's screenshots of a GotPhoto demo job (Settings › Photo access, Photo Management, an album).
- GotPhoto help: [Create albums and edit their settings](https://help.gotphoto.com/en/support/solutions/articles/103000257674-create-albums-and-edit-their-settings), [Album visible to all access codes](https://help.gotphoto.com/en/support/solutions/articles/103000271056-create-an-album-visible-to-all-access-codes).

## 1. Dashboard (first screen after login)

- A setup checklist at the top ("10 to 15 minutes"); you are ready once every item is ticked.
- Key metrics for the account: revenue, number of orders, average order value, login rate, order rate.
- Latest jobs below, with per-job metrics for jobs that are selling.

## 2. Creating a job

- Photo jobs tab › blue **Create new job** (top right).
- Three fields only: **job name**, **picture day date**, **job type** (e.g. Elementary school). The type is used "to categorize and sort reporting".
- Save drops you into the job.
- The jobs list shows: status (every job starts in **Planning**), type, and key dates: date of shoot, activation date, archiving date, coupons deadline.
- Those key dates drive the **communication profile**, the automated emails and SMS sent to potential buyers.

## 3. Job tabs

Settings · Subjects · Tagging · Photo Management · Photo Editing · Communications · Orders and sales · Statistics. The header shows the job name, status pill, internal code, type, client, picture day, a green **Start selling** button and a ⋮ menu.

## 4. Settings tab (first things to set)

- Left side menu: Photo access, Price list, Editing on upload, Important events, Automated campaign, Advanced settings. **Actions ▾** at the top right.
- Turn on the **new shop**.
- **Photo access**, three choices:
  - **Access code for each person** (schools, preschools). This is the usual choice.
  - **One access code** for the whole job (proms, studio, weddings).
  - **Public, no access code** (concerts).
- The access code is "the unique key that identifies the subject to their data". It ties to the QR code and is what parents use to log in to the shop. It gives each subject a private gallery.
- **Choose a method** dropdown, e.g. **QR-Tagging with list of names**.
- Panels under the method: "N subjects, you have imported a Names list" (View names) and **Extra blank QR cards** for unregistered subjects who turn up on picture day.

## 5. Names list import

- A CSV or XLS from the school with: student first name, last name, grade, teacher, student ID, and parent contact information.
- Upload › pick file. If GotPhoto's template headers are used, columns map automatically; otherwise there is a column-matching step.
- A required checkbox: "I came across this contact information legally".
- A preview of the mapping, then **Start import**. Access codes are generated per subject.

## 6. Tagging tab (QR cards)

- QR tagging is "optical capture": photograph the QR card, then the subject. Every photo after a card belongs to that card until the next card.
- **Edit QR card layout**: several designs (e.g. "half page kids, neutral"), the studio logo, contact information, **sort by teacher**, and **stack sort** so printed cards are easy to cut and separate.
- The card goes home with the child as a marketing piece: the parent finds it in the backpack with the shop details and access code.
- Before picture day: job set up, names loaded, cards printed and cut.

## 7. After the shoot: upload

- Download the photos from the camera: QR card photos followed by subject photos.
- Photo Management has a three-step banner: 1 Set watermark (recommended, e.g. "AI Removal Resistant"), 2 Upload photos ("create a new album for every group or category and upload the photos"), 3 Start selling.
- Buttons: **Photo upload methods** and **+ Create new album**. FTP and Lightroom upload are also offered.

## 8. Albums (Photo Management)

- **Album = a group of subjects who share group photos.** The name is free text. GotPhoto recommends one per teacher (school), one per team (sports), one per photo type (seniors), or one for all dancers or one per costume (dance). Re-sorting the names list can build albums by group, teacher or team. Up to 100 albums per job.
- Albums table columns: drag handle, select, thumbnail, Name, Total photos, Group photos, Individual photos, Composites, Accesses, Date, Ordered photos, **Album actions ▾**. A summary row is at the bottom. Delete selected and More… sit above.
- Inside an album: Back, album name, an album switcher dropdown, Album actions ▾ (Delete album, Edit album settings, Download album, Deactivate album).
  - **Group photos** section: visible to everyone in the album. It has a Group photo actions ▾ menu.
  - **Individuals** section: counts of access codes, individual photos and composites, plus Manage individuals ▾. Search by access code, first name, last name, category.
  - Each person block shows individual photos, composites, access code (copy), first name, last name, logins, (potential) buyer, and Manage individual ▾, followed by their photos.
  - The QR card photo stays in the person's photos but is **hidden** (eye-slash icon). A **star** appears on one photo per person; it most likely marks the main/preview photo (inferred from the icon, not confirmed).
  - Selecting: Cmd/Ctrl-click or drag a box. A right panel shows "No photos selected" until then.
- Album settings: name, its own price list (overrides the job's), a description (only for one-code or global-code jobs), deactivate to hide it from customers.
- "Album available for everyone": every photo is a group photo and no QR cards are needed. This can't be undone.
- Photo sorting within albums only works for jobs without activated access codes.

## 8a. Uploading individuals and activating access codes (GotPhoto UK demo transcript)

1. Create the album first (Photo Management › Create new album, any name). Use **separate albums when groups have different group photos**: everyone with individual access to an album also sees its group photos, so Class B must not share Class A's album.
2. An empty album shows two buttons: **Upload Group Photos** ("everyone with access to individual photos of this album will see the group photos as well") and **Upload Individual Photos** ("including the photos with QR codes").
3. Upload all of a group's photos in one go, in shooting order: from the browser (bulk select or drag and drop) or with **EasyUpload**, a desktop app for Windows and Mac (Settings › Photo upload › EasyUpload) that logs in with GotPhoto credentials and lets you pick job › album › individuals or groups.
4. After upload, the photos sit in the album as one flat list. The QR card photos are **highlighted in green with a QR icon**.
5. Check the order is right, then press **Activate access codes**. The system reads the QR positions and splits the list into one section per subject: QR card photo first, then that subject's photos. This takes a minute or two.
6. Each subject's section can be checked straight away in the shop by entering their access code.

So subjects join an album through their QR card photo being uploaded into it, not through the names list. Activation is a separate, manual step after upload.

## 9. Account-level shop settings (Online shop › Shop settings)

- **Logo and design**: studio logo, logo text, page title, primary colour (the shop's call-to-action colour).
- **Language**: many languages; English and Spanish are recommended.
- **Pages and menus**: background image of the main and login page.
- **Shop settings**: purchasing steps (automatic is recommended; photos-first is possible for large galleries, e.g. seniors).
- **Headers**: always show the language selector (any page except the first), show or hide the "school/preschool approved" seal, show or hide the available payment methods.
- **Watermarks**: custom watermarks.
- **Domain**: subdomain (studio.gotphoto.com) or the studio's own domain.
- **Sales**:
  - Payment methods: Stripe Express, Google Pay and Apple Pay.
  - Invoice settings: business details.
  - Advanced invoice settings: receipt logo, extra thank-you text.
  - The tax tab is no longer needed, because GotPhoto is the marketplace facilitator and calculates, collects and remits tax.
  - **Download settings**: a print or copyright release PDF included in downloads.

## 10. Communications setup

- **Email settings**: sender name, reply-to, signature, logo.
- **SMS**: register a Twilio account through GotPhoto (business verification to prevent spam) before SMS is unlocked.

## Open questions for Seenu (not decided)

- Albums, group photos and the "everyone" album versus D60 ("as shot") and D153. The Photos lo-fi frames are tagged "New: needs Seenu".
- Job type: GotPhoto keeps it for reporting; D154 dropped it (the template is the kind of job).
- Dashboard metrics: login rate and order rate.
- The "contact information obtained legally" checkbox on import.
- QR card sort by teacher and stack sort.
- Spanish, the approved seal, the payment-methods display, a print release PDF in downloads.
- Marketplace-facilitator tax (GotPhoto collects and remits) versus our Taxes settings.
- SMS sending and registration.
