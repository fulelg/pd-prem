(function () {
  const POST_SELECTOR = "article.cPost";
  const BUTTON_CLASS = "pd-filter-button";
  const BANNER_ID = "pd-filter-banner";
  const FILTER_ROOT_ID = "pd-filter-root";
  const TOPIC_FEED_ID = "elPostFeed";
  const POSTS_PER_PAGE = 20;
  const MAX_CONCURRENT_REQUESTS = 5;

  const STATE = {
    activeFilter: null,
    filteredView: null,
    pageInfo: null
  };

  function init() {
    ensureBanner();
    enhancePosts();
    initObserver();
  }

  function enhancePosts(root = document) {
    if (!root || typeof root.querySelectorAll !== "function") {
      root = document;
    }
    root.querySelectorAll(POST_SELECTOR).forEach(enhancePost);
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
      displayName: username || userId || "Неизвестно",
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
    button.title = `Показать только сообщения пользователя ${author.displayName}`;
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
      clearFilter();
      return;
    }

    STATE.activeFilter = { key: userKey, username };
    startFilteredMode();
  }

  function clearFilter() {
    STATE.activeFilter = null;
    resetFilteredView();
    updateUIState();
  }

  function startFilteredMode() {
    const author = STATE.activeFilter;
    if (!author) {
      return;
    }

    document.body.classList.add("pd-filter-mode");
    resetFilteredView(true);

    const view = createFilteredView(author);
    STATE.filteredView = view;
    updateUIState();
    collectFilteredPosts(view);
  }

  function resetFilteredView(keepModeClass = false) {
    if (STATE.filteredView) {
      STATE.filteredView.cancelled = true;
      if (STATE.filteredView.collector) {
        STATE.filteredView.collector.cancelled = true;
      }
      STATE.filteredView.root.innerHTML = "";
      STATE.filteredView.root.classList.remove("pd-visible");
      STATE.filteredView = null;
    }

    if (!keepModeClass) {
      document.body.classList.remove("pd-filter-mode");
    }
  }

  function createFilteredView(author) {
    const root = ensureFilteredRoot();
    root.classList.add("pd-visible");
    root.innerHTML = "";

    const summary = document.createElement("div");
    summary.className = "pd-filter-summary";
    root.appendChild(summary);

    const paginationTop = document.createElement("div");
    paginationTop.className = "pd-filter-pagination pd-filter-pagination--top";
    root.appendChild(paginationTop);

    const results = document.createElement("div");
    results.className = "pd-filter-results";
    root.appendChild(results);

    const paginationBottom = document.createElement("div");
    paginationBottom.className = "pd-filter-pagination pd-filter-pagination--bottom";
    root.appendChild(paginationBottom);

    [paginationTop, paginationBottom].forEach((node) => {
      node.addEventListener("click", handlePaginationClick);
    });

    return {
      author,
      root,
      summaryNode: summary,
      resultsNode: results,
      paginationNodes: [paginationTop, paginationBottom],
      posts: [],
      perPage: POSTS_PER_PAGE,
      currentPage: 1,
      totalPages: 0,
      cancelled: false,
      loadingText: ""
    };
  }

  function ensureFilteredRoot() {
    let root = document.getElementById(FILTER_ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = FILTER_ROOT_ID;
      const feed = document.getElementById(TOPIC_FEED_ID);
      if (feed) {
        feed.insertAdjacentElement("afterend", root);
      } else {
        document.body.appendChild(root);
      }
    }
    return root;
  }

  async function collectFilteredPosts(view) {
    const pageInfo = getPageInfo();
    if (!pageInfo) {
      view.resultsNode.innerHTML = `<div class="pd-filter-empty">Не удалось определить страницы темы.</div>`;
      setFilteredSummary(view, { totalPosts: 0, isLoading: false });
      updateBanner();
      return;
    }

    const traversal = buildTraversalOrder(pageInfo.currentPage, pageInfo.totalPages);
    const parser = new DOMParser();
    const collectorState = {
      pageInfo,
      parser,
      traversal,
      processed: 0,
      total: traversal.length,
      active: true,
      cancelled: false,
      seen: new Set(),
      nextIndex: 0
    };

    view.collector = collectorState;
    updateCollectorProgress(view, { forcePlaceholder: true });

    const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, traversal.length);
    const workers = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(runCollectorWorker(view, collectorState));
    }

    await Promise.all(workers);
    collectorState.active = false;

    if (shouldStopCollecting(view, collectorState)) {
      return;
    }

    if (!view.posts.length) {
      view.resultsNode.innerHTML = `<div class="pd-filter-empty">У выбранного пользователя нет сообщений в этой теме.</div>`;
      setFilteredSummary(view, { totalPosts: 0, isLoading: false });
    } else {
      renderFilteredResults(view);
    }

    updateCollectorProgress(view);
  }

  async function runCollectorWorker(view, collectorState) {
    while (true) {
      if (shouldStopCollecting(view, collectorState)) {
        return;
      }

      const pageNumber = getNextCollectorPage(collectorState);
      if (pageNumber == null) {
        return;
      }

      const pageInfo = collectorState.pageInfo;
      let root = null;
      if (pageNumber === pageInfo.currentPage) {
        root = document.getElementById(TOPIC_FEED_ID) || document;
      } else {
        const html = await fetchPageHtml(buildPageUrl(pageNumber, pageInfo));
        if (!html) {
          collectorState.processed += 1;
          updateCollectorProgress(view);
          continue;
        }
        root = collectorState.parser.parseFromString(html, "text/html");
      }

      const matches = extractMatchingPosts(root, pageNumber, view.author.key);
      let added = 0;
      matches.forEach((match) => {
        if (!match.commentId || collectorState.seen.has(match.commentId)) {
          return;
        }
        collectorState.seen.add(match.commentId);
        view.posts.push(match);
        added += 1;
      });

      collectorState.processed += 1;

      if (added) {
        view.posts.sort((a, b) => a.order - b.order);
        renderFilteredResults(view);
      } else if (!view.posts.length) {
        updateCollectorProgress(view, { forcePlaceholder: true });
      } else {
        updateCollectorProgress(view);
      }

      await waitForNextFrame();
    }
  }

  function getNextCollectorPage(collectorState) {
    if (collectorState.nextIndex >= collectorState.traversal.length) {
      return null;
    }
    const pageNumber = collectorState.traversal[collectorState.nextIndex];
    collectorState.nextIndex += 1;
    return pageNumber;
  }

  function shouldStopCollecting(view, collectorState) {
    return (
      !STATE.activeFilter ||
      STATE.filteredView !== view ||
      view.cancelled ||
      collectorState.cancelled ||
      STATE.activeFilter.key !== view.author.key
    );
  }

  function updateCollectorProgress(view, { forcePlaceholder = false } = {}) {
    if (!view) {
      return;
    }
    const message = buildProgressMessage(view);
    view.loadingText = message;
    const shouldShowPlaceholder =
      forcePlaceholder || (!view.posts.length && view.collector?.active);
    if (shouldShowPlaceholder && view.resultsNode) {
      view.resultsNode.innerHTML = `<div class="pd-filter-loading">${message}</div>`;
      view.paginationNodes?.forEach((node) => {
        node.innerHTML = "";
      });
    }
    const isLoading = Boolean(view.collector?.active);
    setFilteredSummary(view, { totalPosts: view.posts.length, isLoading });
    updateBanner();
  }

  function buildProgressMessage(view) {
    const processed = view.collector?.processed || 0;
    const total = view.collector?.total || "?";
    const posts = view.posts?.length || 0;
    return `Обработано страниц: ${processed}/${total}. Найдено сообщений: ${posts}`;
  }

  function waitForNextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function buildTraversalOrder(current, total) {
    const order = [];
    const visited = new Set();

    const push = (page) => {
      if (page >= 1 && page <= total && !visited.has(page)) {
        visited.add(page);
        order.push(page);
      }
    };

    push(current);
    let offset = 1;
    while (order.length < total) {
      push(current - offset);
      push(current + offset);
      offset += 1;
      if (offset > total && order.length < total) {
        // fallback, just to avoid infinite loop
        for (let page = 1; page <= total; page += 1) {
          push(page);
        }
      }
    }

    return order;
  }

  function extractMatchingPosts(root, pageNumber, targetKey) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }

    const matches = [];
    root.querySelectorAll(POST_SELECTOR).forEach((article, index) => {
      const author = extractAuthor(article);
      if (!author || author.key !== targetKey) {
        return;
      }
      const commentNode = article.querySelector("[data-commentid]");
      const commentId = commentNode?.dataset.commentid || article.id || `${pageNumber}_${index}`;
      const anchor = `<a id="comment-${commentId}"></a>`;
      const clone = article.cloneNode(true);
      if (clone.dataset) {
        delete clone.dataset.pdEnhanced;
        delete clone.dataset.pdUserKey;
        delete clone.dataset.pdUserName;
      }
      clone.classList?.remove("pd-post-hidden", "pd-post-highlight");
      const wrapper = document.createElement("div");
      wrapper.appendChild(clone);
      matches.push({
        commentId,
        pageNumber,
        order: pageNumber * 1000 + index,
        html: `${anchor}${wrapper.innerHTML}`
      });
    });
    return matches;
  }

  async function fetchPageHtml(url) {
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) {
        return null;
      }
      return await response.text();
    } catch (err) {
      return null;
    }
  }

  function buildPageUrl(pageNumber, pageInfo) {
    const base = pageInfo.baseUrl.replace(/\/$/, "");
    const suffix = pageInfo.tab ? `?tab=${encodeURIComponent(pageInfo.tab)}` : "";
    if (pageNumber <= 1) {
      return `${base}/${suffix}`.replace(/\/\?/, "?");
    }
    return `${base}/page/${pageNumber}/${suffix}`.replace(/\/\?/, "?");
  }

  function getPageInfo() {
    if (STATE.pageInfo) {
      return STATE.pageInfo;
    }

    const pagination = document.querySelector(".ipsPagination[data-pages]");
    const totalPages =
      parseInt(
        pagination?.dataset.pages ||
          pagination?.getAttribute("data-ipsPagination-pages") ||
          "1",
        10
      ) || 1;

    let currentPage = parseInt(
      pagination?.querySelector(".ipsPagination_active a[data-page]")?.dataset.page ||
        "",
      10
    );
    if (Number.isNaN(currentPage) || currentPage < 1) {
      const match = window.location.pathname.match(/\/page\/(\d+)/);
      currentPage = match ? parseInt(match[1], 10) : 1;
    }

    const url = new URL(window.location.href);
    const matchBase = url.pathname.match(/(.*?\/topic\/\d+)/);
    const baseUrl = `${url.origin}${matchBase ? matchBase[1] : url.pathname}`.replace(/\/$/, "");

    STATE.pageInfo = {
      baseUrl,
      totalPages,
      currentPage,
      tab: url.searchParams.get("tab")
    };
    return STATE.pageInfo;
  }

  function renderFilteredResults(view) {
    if (!view || view.cancelled) {
      return;
    }

    const totalPosts = view.posts.length;
    view.totalPages = Math.max(1, Math.ceil(totalPosts / view.perPage));
    view.currentPage = Math.min(view.currentPage, view.totalPages);

    const startIndex = (view.currentPage - 1) * view.perPage;
    const slice = view.posts.slice(startIndex, startIndex + view.perPage);

    if (slice.length === 0) {
      if (view.collector?.active) {
        view.resultsNode.innerHTML = `<div class="pd-filter-loading">Эта страница ещё загружается…</div>`;
      } else {
        view.resultsNode.innerHTML = `<div class="pd-filter-empty">Сообщения отсутствуют на этой странице.</div>`;
      }
    } else {
      view.resultsNode.innerHTML = slice.map((post) => post.html).join("");
      enhancePosts(view.resultsNode);
    }

    setFilteredSummary(view, { totalPosts, isLoading: Boolean(view.collector?.active) });
    renderFilteredPagination(view);
    updateBanner();
  }

  function setFilteredSummary(view, { totalPosts = 0, isLoading = false } = {}) {
    if (!view?.summaryNode || !STATE.activeFilter) {
      return;
    }
    const base = `Сообщения пользователя ${STATE.activeFilter.username}`;
    if (!totalPosts) {
      const suffix = isLoading ? ` · ${buildProgressMessage(view)}` : " · сообщений нет";
      view.summaryNode.textContent = `${base}${suffix}`;
      return;
    }

    const pagePart = ` · страница ${view.currentPage} из ${view.totalPages}`;
    const totalPart = ` · всего ${totalPosts}`;
    const progressPart = isLoading ? ` · ${buildProgressMessage(view)}` : "";
    view.summaryNode.textContent = `${base}${totalPart}${pagePart}${progressPart}`;
  }

  function renderFilteredPagination(view) {
    if (!view) {
      return;
    }

    view.paginationNodes.forEach((node) => {
      node.innerHTML = "";
      const info = document.createElement("div");
      info.className = "pd-pagination-info";
      const loadingSuffix = view.collector?.active ? " · идёт загрузка" : "";
      info.textContent = `Страница ${view.currentPage} из ${view.totalPages}${loadingSuffix}`;

      if (view.totalPages <= 1) {
        node.appendChild(info);
        return;
      }

      const ul = document.createElement("ul");
      ul.className = "ipsPagination pd-pagination";
      ul.dataset.pages = String(view.totalPages);

      ul.appendChild(createNavButton(view, "first", 1, view.currentPage > 1));
      ul.appendChild(createNavButton(view, "prev", view.currentPage - 1, view.currentPage > 1));

      buildPageWindow(view.currentPage, view.totalPages).forEach((entry) => {
        if (entry === "gap") {
          const gap = document.createElement("li");
          gap.className = "ipsPagination_gap";
          gap.innerHTML = "<span>…</span>";
          ul.appendChild(gap);
          return;
        }
        const li = document.createElement("li");
        li.className = "ipsPagination_page";
        if (entry === view.currentPage) {
          li.classList.add("ipsPagination_active");
        }
        const link = document.createElement("a");
        link.href = "#";
        link.dataset.pdPage = String(entry);
        link.textContent = entry.toString();
        li.appendChild(link);
        ul.appendChild(li);
      });

      ul.appendChild(createNavButton(view, "next", view.currentPage + 1, view.currentPage < view.totalPages));
      ul.appendChild(createNavButton(view, "last", view.totalPages, view.currentPage < view.totalPages));

      node.appendChild(ul);
      node.appendChild(info);
    });
  }

  function createNavButton(view, type, targetPage, enabled) {
    const li = document.createElement("li");
    li.className = `ipsPagination_${type}`;
    const link = document.createElement("a");
    link.href = "#";

    if (type === "first") {
      link.innerHTML = "<i class='fa fa-angle-double-left'></i>";
    } else if (type === "last") {
      link.innerHTML = "<i class='fa fa-angle-double-right'></i>";
    } else if (type === "prev") {
      link.textContent = "Назад";
    } else if (type === "next") {
      link.textContent = "Вперёд";
    }

    if (enabled) {
      const safePage = Math.min(Math.max(targetPage, 1), view.totalPages);
      link.dataset.pdPage = String(safePage);
    } else {
      li.classList.add("ipsPagination_inactive");
      link.setAttribute("aria-disabled", "true");
    }

    li.appendChild(link);
    return li;
  }

  function buildPageWindow(current, total) {
    const pages = new Set([1, total, current]);
    for (let offset = 1; offset <= 2; offset += 1) {
      if (current - offset > 1) {
        pages.add(current - offset);
      }
      if (current + offset < total) {
        pages.add(current + offset);
      }
    }
    const sorted = Array.from(pages).sort((a, b) => a - b);
    const sequence = [];
    sorted.forEach((page, index) => {
      sequence.push(page);
      const next = sorted[index + 1];
      if (next && next - page > 1) {
        sequence.push("gap");
      }
    });
    return sequence;
  }

  function handlePaginationClick(event) {
    const link = event.target.closest("[data-pd-page]");
    if (!link) {
      return;
    }
    event.preventDefault();
    const page = parseInt(link.dataset.pdPage, 10);
    if (!STATE.filteredView || Number.isNaN(page)) {
      return;
    }
    goToFilteredPage(page);
  }

  function goToFilteredPage(pageNumber) {
    const view = STATE.filteredView;
    if (!view) {
      return;
    }
    const safePage = Math.min(Math.max(pageNumber, 1), view.totalPages);
    if (safePage === view.currentPage) {
      return;
    }
    view.currentPage = safePage;
    renderFilteredResults(view);
  }

  function applyCurrentFilterToPost(article) {
    const matches =
      !STATE.activeFilter ||
      article.dataset.pdUserKey === STATE.activeFilter.key;

    const shouldHide =
      Boolean(STATE.activeFilter) &&
      !document.body.classList.contains("pd-filter-mode") &&
      !matches;

    article.classList.toggle("pd-post-hidden", shouldHide);
    article.classList.toggle("pd-post-highlight", Boolean(STATE.activeFilter && matches));
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
    clearButton.textContent = "Сбросить фильтр";
    clearButton.addEventListener("click", (event) => {
      event.preventDefault();
      clearFilter();
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
    const clearButton = banner.querySelector(".pd-filter-clear");
    if (!STATE.activeFilter) {
      banner.classList.remove("pd-visible");
      label.textContent = "Фильтр не активен";
      clearButton.disabled = true;
      return;
    }

    banner.classList.add("pd-visible");
    clearButton.disabled = false;

    const view = STATE.filteredView;
    if (view?.collector?.active) {
      label.textContent = `Пользователь ${STATE.activeFilter.username} · ${buildProgressMessage(view)}`;
      return;
    }

    if (view?.posts.length) {
      label.textContent = `Пользователь ${STATE.activeFilter.username} · ${view.posts.length} сообщений · страница ${view.currentPage}/${view.totalPages}`;
    } else {
      label.textContent = `У пользователя ${STATE.activeFilter.username} нет сообщений в этой теме`;
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

