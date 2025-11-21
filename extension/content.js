(function () {
  const POST_SELECTOR = "article.cPost";
  const BUTTON_CLASS = "pd-filter-button";
  const BANNER_ID = "pd-filter-banner";
  const STATE = {
    activeFilter: null
  };

  function init() {
    ensureBanner();
    enhanceExistingPosts();
    initObserver();
  }

  function enhanceExistingPosts() {
    document.querySelectorAll(POST_SELECTOR).forEach(enhancePost);
  }

  function initObserver() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) {
            return;
          }
          if (node.matches(POST_SELECTOR)) {
            enhancePost(node);
          }
          node.querySelectorAll?.(POST_SELECTOR).forEach(enhancePost);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function enhancePost(article) {
    if (!(article instanceof HTMLElement) || article.dataset.pdEnhanced === "true") {
      return;
    }

    const author = extractAuthor(article);
    if (!author || !author.key) {
      return;
    }

    article.dataset.pdEnhanced = "true";
    article.dataset.pdUserKey = author.key;
    article.dataset.pdUserName = author.displayName;

    const button = createButton(author);
    attachButton(article, button);
    applyCurrentFilterToPost(article);
  }

  function extractAuthor(article) {
    const quotedDataNode = article.querySelector("[data-quotedata]");
    let userId;
    let username;

    if (quotedDataNode) {
      try {
        const data = JSON.parse(quotedDataNode.dataset.quotedata || "{}");
        userId = data?.userid?.toString();
        username = data?.username?.trim();
      } catch (err) {
        // no-op
      }
    }

    if (!username) {
      const profileLink = article.querySelector(".cAuthorPane_author a[href*='/profile/']");
      if (profileLink) {
        username = profileLink.textContent?.trim() || undefined;
        const idMatch = profileLink.href.match(/profile\/(\d+)/);
        if (!userId && idMatch) {
          userId = idMatch[1];
        }
      }
    }

    if (!username) {
      const heading = article.querySelector(".cAuthorPane_author");
      username = heading?.textContent?.trim();
    }

    const key = computeUserKey(userId, username);
    if (!key) {
      return null;
    }

    return {
      id: userId || null,
      displayName: username || userId || "Unknown",
      key
    };
  }

  function computeUserKey(userId, username) {
    if (userId) {
      return `id:${userId}`;
    }
    if (username) {
      return `name:${username.toLowerCase()}`;
    }
    return null;
  }

  function createButton(author) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.dataset.userKey = author.key;
    button.dataset.username = author.displayName;
    button.title = `Show only posts by ${author.displayName}`;
    button.innerHTML = createMagnifierIcon();
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleFilter(author.key, author.displayName);
    });
    return button;
  }

  function createMagnifierIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10" cy="10" r="7" stroke-width="2" fill="none"></circle>
        <line x1="15" y1="15" x2="21" y2="21" stroke-width="2"></line>
      </svg>
    `;
  }

  function attachButton(article, button) {
    const toolsList = article.querySelector(".ipsComment_tools");
    if (toolsList) {
      const listItem = document.createElement("li");
      listItem.appendChild(button);
      toolsList.appendChild(listItem);
      return;
    }

    const meta = article.querySelector(".ipsComment_meta");
    if (meta) {
      meta.appendChild(button);
      return;
    }

    article.appendChild(button);
  }

  function toggleFilter(userKey, username) {
    if (STATE.activeFilter?.key === userKey) {
      STATE.activeFilter = null;
    } else {
      STATE.activeFilter = { key: userKey, username };
    }
    updateUIState();
  }

  function applyCurrentFilterToPost(article) {
    const matches =
      !STATE.activeFilter ||
      article.dataset.pdUserKey === STATE.activeFilter.key;

    article.classList.toggle("pd-post-hidden", !matches);
    article.classList.toggle("pd-post-highlight", STATE.activeFilter && matches);
  }

  function updateButtonStates() {
    document
      .querySelectorAll(`.${BUTTON_CLASS}`)
      .forEach((button) => {
        const isActive =
          STATE.activeFilter?.key === button.dataset.userKey;
        button.classList.toggle("pd-active", Boolean(isActive));
      });
  }

  function ensureBanner() {
    if (document.getElementById(BANNER_ID)) {
      return;
    }

    const banner = document.createElement("div");
    banner.id = BANNER_ID;

    const label = document.createElement("span");
    label.className = "pd-filter-label";
    banner.appendChild(label);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "pd-filter-clear";
    clearButton.textContent = "Reset filter";
    clearButton.addEventListener("click", () => {
      STATE.activeFilter = null;
      updateUIState();
    });
    banner.appendChild(clearButton);

    document.body.appendChild(banner);
    updateBanner();
  }

  function updateBanner() {
    const banner = document.getElementById(BANNER_ID);
    if (!banner) {
      return;
    }

    const label = banner.querySelector(".pd-filter-label");
    if (STATE.activeFilter) {
      banner.classList.add("pd-visible");
      label.textContent = `Showing only posts from ${STATE.activeFilter.username}`;
    } else {
      banner.classList.remove("pd-visible");
      label.textContent = "No filter applied";
    }
  }

  function updateUIState() {
    document
      .querySelectorAll(POST_SELECTOR)
      .forEach(applyCurrentFilterToPost);
    updateButtonStates();
    updateBanner();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

