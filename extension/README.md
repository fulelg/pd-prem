# Prodota User Filter

Chrome extension that adds a magnifying-glass button to every post on the [ProDota forum](https://prodota.ru/forum/topic/224176/page/721/?tab=comments#comment-28542905), so you can leave only the chosen author's messages on the current page.

## Features

- Injects a search button into every `article.cPost` block.
- Filters posts with a single click; the second click clears the filter.
- Shows a floating status pill with the active filter and a reset button.
- Watches dynamic updates via a `MutationObserver`.

## Installation

1. Open `chrome://extensions/`.
2. Enable Developer Mode (top-right corner).
3. Click “Load unpacked” and select the `extension` directory.

Then open any topic page on the forum and use the magnifier button near the desired post.

