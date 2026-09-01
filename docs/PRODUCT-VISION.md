# ReadTrail Product Vision

## Status

This is a living product compass, not a fixed feature specification. It records the decisions we have made, the direction we are exploring, and the questions that still require product judgment.

## Vision

ReadTrail helps people read long, text-heavy material in their browser without losing their place, their momentum, or the ideas they want to return to.

The initial product remembers exactly where someone stopped reading. Over time, it may help readers understand what a page contributed to their knowledge and connect ideas across what they read.

ReadTrail must never become merely a cursor trail.

## Who It Is For

ReadTrail is for people who read frequently on laptops and desktop computers and want to concentrate more deeply while reading in a browser.

They may be reading articles, essays, documentation, research, or other long pages. Their immediate frustration is simple: dense text makes it easy to lose the current line, forget where they stopped, or abandon unfinished reading because returning takes too much effort.

## The Core Promise

ReadTrail should make three things noticeably easier:

1. Follow the text while actively reading.
2. Stop without worrying about losing the exact reading position.
3. Return later and continue with minimal effort.

After five minutes, navigation through a long page should feel easier. After returning to a page later, the reader should feel that their place was remembered for them.

## Product Principles

### Reading comes first

ReadTrail should remain quiet and lightweight. It should support attention without becoming another interface the reader has to manage.

### The browser is the natural home

Most of the target reading already happens in a browser. ReadTrail should feel built into that environment rather than like a separate reading application.

### Use is intentional

Readers may not want ReadTrail on every page. The product should be opt-in per page and should not collect reading state before the reader activates it.

### Memory should be trustworthy

When ReadTrail says it remembers a position or bookmark, the reader should be able to rely on it. Saved state should survive looking elsewhere and should reappear when the trail is turned back on.

### Privacy is part of the product

Reading history can reveal sensitive interests. ReadTrail should collect the minimum information needed, store it locally by default, and make saving an explicit choice.

### Grow from position to understanding

Exact reading position is the foundation. Knowledge capture and connection are future layers, not excuses to weaken the initial experience.

## Initial Experience

### Activation

- ReadTrail is activated intentionally on a page.
- A reader can turn the trail off without deleting saved positions or bookmarks.
- Turning it on again restores the relevant reading markers.

### Active reading

- The trail helps the reader track the current line.
- Activating ReadTrail puts the page into an explicit reading lock: primary page clicks pause or resume the reading position instead of activating the underlying page.
- Before activation, ReadTrail clearly warns that links, buttons, and other clicked controls will remain unavailable until ReadTrail is turned off.
- A single primary click freezes or unfreezes the current position, including when the text beneath it is part of a link or control.
- A double click creates a persistent bookmark immediately and leaves the position frozen.
- Scrolling and text selection remain available while reading lock is active.
- Turning ReadTrail off immediately restores normal page interaction.

### Reading position

- Each activated page has one automatic current reading position.
- This position represents where the reader most recently stopped or paused.
- Returning to a page should make continuing from that position easy.

### Intentional bookmarks

- A page can contain multiple persistent bookmarks.
- Bookmarks are deliberate markers for passages or positions the reader wants to revisit.
- They remain visible when ReadTrail is active and are hidden, not deleted, when it is turned off.

### Leaving a page

- A temporary reading trail should not silently become permanent history.
- When a reader leaves or closes an active page, ReadTrail should offer an optional way to save the position.
- The reader should be able to choose an ongoing preference such as ask every time, always save, or do not automatically save.
- Notifications or prompts should be optional.

Browser constraints may affect exactly when and where this choice is presented. The product intent is more important than a particular dialog mechanism.

### Reading space

A separate extension page should eventually provide a calm overview of:

- Continue reading
- Saved bookmarks
- Completed reading
- Reading history, when the reader has chosen to retain it

This space should help readers resume and organize reading, not become a noisy analytics dashboard.

## Privacy Commitments

- No reading state is captured before activation on a page.
- Saved data is local by default.
- Permanent history requires a clear user choice.
- Temporary session state should expire with the browser session unless saved.
- Incognito reading should not be retained.
- Readers should be able to delete individual records, clear all records, and exclude sites.
- ReadTrail should store only what is required to restore a position or bookmark.
- Cloud sync, accounts, content analysis, and external transmission are outside the initial product unless deliberately reconsidered later.

## Product Layers

### Foundation: place

Remember the exact reading position reliably.

### Next: return

Make unfinished reading and intentional bookmarks easy to find and resume.

### Later: reflection

Allow readers to preserve selected passages, reactions, or questions when they explicitly choose to do so.

### Future: knowledge

Help readers understand what a page contributed to their existing knowledge and discover connections across their reading.

The future knowledge layer is directional. Its interaction model, data model, and role in the product remain undecided.

## What ReadTrail Is Not

- A decorative cursor effect
- An automatic surveillance log of browsing activity
- A read-it-later dumping ground with no sense of position
- A productivity dashboard that judges how much someone reads
- A replacement for the browser or the original page
- An AI summarizer by default

## Success Signals

Early success should be judged by reader outcomes rather than engagement for its own sake:

- Readers can resume at the correct place.
- Readers lose their line less often while reading.
- Readers return to unfinished material they intended to finish.
- Saving and deleting reading state feels understandable and trustworthy.
- The tool supports focus without demanding attention.

Exact measurements and any analytics approach remain undecided and must respect the privacy commitments above.

## Decisions Already Made

- Exact reading position is the initial product foundation.
- ReadTrail is opt-in per page.
- A page has one automatic current position and may have multiple intentional bookmarks.
- Active ReadTrail is an explicit reading lock: single click freezes or unfreezes instead of activating page controls, and double click creates a persistent bookmark.
- The activation UI warns readers about reading lock before it is enabled; scrolling and text selection remain available.
- Turning the trail off hides markers without deleting them.
- Permanent saving is a separate decision.
- Save prompts and ongoing save preferences are optional and user-controlled.
- Local-first privacy is required.
- A separate reading space belongs in the product direction.
- Imported passages, personal reactions, questions, and knowledge connections are later possibilities.

## Open Product Questions

- What is the simplest activation gesture that feels native to the browser?
- How should keyboard-triggered page actions behave while reading lock is active?
- How precise must position restoration be when a page changes between visits?
- What should a saved item contain beyond its URL and position?
- When does an unfinished item become completed?
- What is the least intrusive way to offer saving when a tab closes?
- How should the reading space group and present unfinished pages?
- What does “contributed to my knowledge” mean from the reader's point of view?
- Which future knowledge features genuinely improve reading rather than create collection overhead?

## Working Relationship

The product vision belongs to its creator. AI collaborators can clarify choices, expose tradeoffs, test assumptions, and implement agreed work, but should not silently decide the product direction. New features should be traced to a user problem, an explicit product decision, or a clearly labeled experiment.
