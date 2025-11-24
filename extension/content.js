(function () {
  const POST_SELECTOR = "article.cPost";
  const BUTTON_CLASS = "pd-filter-button";
  const BANNER_ID = "pd-filter-banner";
  const FILTER_ROOT_ID = "pd-filter-root";
  const TOPIC_FEED_ID = "elPostFeed";
  const POSTS_PER_PAGE = 20;
  const MAX_CONCURRENT_REQUESTS = 5;
  const QUOTE_COLLAPSE_MIN_LINES = 10;
  const QUOTE_COLLAPSE_MIN_LENGTH = 600;
  const PENDING_FILTER_KEY = "pdFilterPending";
  const PENDING_FILTER_TTL = 2 * 60 * 1000;

  const STATE = {
    activeFilter: null,
    filteredView: null,
    pageInfo: null,
    allPosts: [],
    allPostsCollected: false,
    allPostsCollector: null
  };

  function isMafiaSection() {
    const breadcrumbs = document.querySelector(".ipsBreadcrumb, .ipsBreadcrumb_1, [data-role='breadcrumb']");
    if (breadcrumbs) {
      const breadcrumbText = breadcrumbs.textContent.toLowerCase();
      if (breadcrumbText.includes("мафия") || breadcrumbText.includes("mafia")) {
        return true;
      }
    }

    const pageTitle = document.title.toLowerCase();
    if (pageTitle.includes("мафия") || pageTitle.includes("mafia")) {
      return true;
    }

    const url = window.location.href.toLowerCase();
    if (url.includes("mafia") || url.includes("мафия")) {
      return true;
    }

    const navLinks = document.querySelectorAll("nav a, .ipsBreadcrumb a, [data-role='breadcrumb'] a");
    for (const link of navLinks) {
      const linkText = link.textContent.toLowerCase();
      if (linkText.includes("мафия") || linkText.includes("mafia")) {
        return true;
      }
    }

    return false;
  }

  function init() {
    if (!isMafiaSection()) {
      return;
    }

    ensureBanner();
    enhancePosts();
    initObserver();
    restorePendingFilterIfNeeded();
    ensureLikesButton();
    initNavigationWatcher();
  }

  function initNavigationWatcher() {
    let lastUrl = window.location.href;
    let checkInterval = null;

    const checkUrl = () => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        setTimeout(() => {
          ensureLikesButton();
        }, 100);
      }
    };

    window.addEventListener("popstate", checkUrl);
    window.addEventListener("hashchange", checkUrl);

    if (window.history && window.history.pushState) {
      const originalPushState = window.history.pushState;
      window.history.pushState = function(...args) {
        originalPushState.apply(window.history, args);
        setTimeout(checkUrl, 50);
      };
    }

    if (window.history && window.history.replaceState) {
      const originalReplaceState = window.history.replaceState;
      window.history.replaceState = function(...args) {
        originalReplaceState.apply(window.history, args);
        setTimeout(checkUrl, 50);
      };
    }

    checkInterval = setInterval(() => {
      if (!document.getElementById("pd-likes-button") && document.getElementById(TOPIC_FEED_ID)) {
        ensureLikesButton();
      }
    }, 1000);
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

          if (node.id === TOPIC_FEED_ID || node.querySelector?.(`#${TOPIC_FEED_ID}`)) {
            ensureLikesButton();
          }
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
    if (article.dataset.pdUserName === "Fulelgupport") {
      const nickname = article.querySelector(".defrelNickTopic").querySelector("a");
      const role = article.querySelector(".cAuthorPane_info").querySelectorAll("li")[2].querySelector("span");
      const desc = article.querySelector(".cAuthorPane_info").querySelectorAll("li")[0];
      const img = article.querySelector(".cAuthorPane_info").querySelectorAll("li")[3];
      nickname.style.color = "#FFD700";
      role.textContent = "Enhancer Creator";
      role.style.color = "#FFD700";
      desc.textContent = "Бос";
      img.innerHTML = `<p>🧑‍💻🧑‍💻🧑‍💻</p>`;
    }
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

    if (redirectToFirstPage(userKey, username)) {
      return;
    }

    STATE.activeFilter = {
      key: userKey,
      username,
      keywords: [],
      keywordInput: "",
      awaitingApply: false
    };
    
    // Если посты еще не собраны, сначала показываем загрузку и собираем посты
    if (!STATE.allPostsCollected && !STATE.allPostsCollector) {
      startLoadingMode();
      // Запускаем сбор всех постов
      collectAllPosts().then(() => {
        // После сбора постов показываем полный блок с фильтром
        if (STATE.activeFilter) {
          startFilteredMode();
        }
      }).catch((err) => {
        console.error("Ошибка при сборе постов:", err);
        // В случае ошибки все равно показываем фильтр
        if (STATE.activeFilter) {
          startFilteredMode();
        }
      });
    } else if (STATE.allPostsCollector) {
      // Если сбор уже идет, показываем загрузку и ждем
      startLoadingMode();
      collectAllPosts().then(() => {
        if (STATE.activeFilter) {
          startFilteredMode();
        }
      });
    } else {
      // Если посты уже собраны, сразу показываем фильтр
      startFilteredMode();
    }
  }
  
  function startLoadingMode() {
    const author = STATE.activeFilter;
    if (!author) {
      return;
    }

    document.body.classList.add("pd-filter-mode");
    resetFilteredView(true);

    // Создаем минимальный view только с индикатором загрузки
    const root = ensureFilteredRoot();
    root.classList.add("pd-visible");
    root.innerHTML = "";

    const summary = document.createElement("div");
    summary.className = "pd-filter-summary";
    summary.textContent = `Сбор постов со всех страниц...`;
    root.appendChild(summary);

    const results = document.createElement("div");
    results.className = "pd-filter-results";
    results.innerHTML = `<div class="pd-filter-loading">Начинаем сбор постов...</div>`;
    root.appendChild(results);

    const view = {
      author,
      root,
      summaryNode: summary,
      resultsNode: results,
      paginationNodes: [],
      keywordControls: null,
      keywords: [],
      awaitingApply: false,
      posts: [],
      perPage: POSTS_PER_PAGE,
      currentPage: 1,
      totalPages: 0,
      cancelled: false,
      loadingText: ""
    };

    STATE.filteredView = view;
    updateUIState();
  }

  function clearFilter() {
    STATE.activeFilter = null;
    resetFilteredView();
    STATE.pageInfo = null;
    updateUIState();
  }

  function startFilteredMode() {
    const author = STATE.activeFilter;
    if (!author) {
      return;
    }

    // Не показываем блок с фильтром, если посты еще не собраны
    if (!STATE.allPostsCollected) {
      console.warn("Попытка показать фильтр до завершения сбора постов");
      return;
    }

    document.body.classList.add("pd-filter-mode");
    resetFilteredView(true);

    const view = createFilteredView(author);
    STATE.filteredView = view;
    initializeKeywordControls(view);
    
    filterPostsByUser(view, author.key);
    renderFilteredResults(view);
    updateUIState();
    document.querySelector(".pd-keyword-apply").click()
  }
  
  function filterPostsByUser(view, userKey) {
    if (!view || !userKey) {
      view.posts = [];
      return;
    }
    
    // Фильтруем уже собранные посты по пользователю
    view.posts = STATE.allPosts
      .filter(post => post.authorKey === userKey)
      .map(post => ({
        commentId: post.commentId,
        pageNumber: post.pageNumber,
        order: post.order,
        html: post.html,
        text: post.text
      }));
    
    // Сортируем по порядку
    view.posts.sort((a, b) => a.order - b.order);
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

    const view = {
      author,
      root,
      summaryNode: summary,
      resultsNode: results,
      paginationNodes: [paginationTop, paginationBottom],
      keywordControls: null,
      keywords: Array.isArray(STATE.activeFilter?.keywords) ? [...STATE.activeFilter.keywords] : [],
      awaitingApply: STATE.activeFilter?.awaitingApply !== false,
      posts: [],
      perPage: POSTS_PER_PAGE,
      currentPage: 1,
      totalPages: 0,
      cancelled: false,
      loadingText: ""
    };

    view.keywordControls = attachKeywordControls(view, paginationTop);
    return view;
  }

  function collectAllAuthors() {
    const authorsMap = new Map();
    
    // Если посты уже собраны, используем их
    if (STATE.allPostsCollected && STATE.allPosts.length > 0) {
      STATE.allPosts.forEach((post) => {
        if (post.authorKey && post.authorName) {
          if (!authorsMap.has(post.authorKey)) {
            authorsMap.set(post.authorKey, {
              key: post.authorKey,
              displayName: post.authorName,
              id: null // ID не сохраняется в собранных постах
            });
          }
        }
      });
    } else {
      // Иначе собираем из DOM
      const articles = document.querySelectorAll(POST_SELECTOR);
      articles.forEach((article) => {
        const author = extractAuthor(article);
        if (author && author.key) {
          if (!authorsMap.has(author.key)) {
            authorsMap.set(author.key, {
              key: author.key,
              displayName: author.displayName,
              id: author.id
            });
          }
        }
      });
    }
    
    return Array.from(authorsMap.values()).sort((a, b) => 
      a.displayName.localeCompare(b.displayName, 'ru')
    );
  }

  function attachKeywordControls(view, anchorNode) {
    if (!view || !anchorNode) {
      return null;
    }

    const container = document.createElement("div");
    container.className = "pd-keyword-filter";

    const heading = document.createElement("div");
    heading.className = "pd-keyword-heading";
    heading.textContent = "Фильтр по ключевым словам";
    container.appendChild(heading);

    // Добавляем переключатель пользователей
    const userSwitchContainer = document.createElement("div");
    userSwitchContainer.className = "pd-user-switch-container";
    
    const userSwitchLabel = document.createElement("label");
    userSwitchLabel.className = "pd-user-switch-label";
    userSwitchLabel.textContent = "Пользователь:";
    userSwitchLabel.htmlFor = "pd-user-switch";
    userSwitchContainer.appendChild(userSwitchLabel);
    
    const userSwitch = document.createElement("select");
    userSwitch.id = "pd-user-switch";
    userSwitch.className = "pd-user-switch";
    
    // Инициализируем список пользователей
    const allAuthors = collectAllAuthors();
    allAuthors.forEach((author) => {
      const option = document.createElement("option");
      option.value = author.key;
      option.textContent = author.displayName;
      if (view.author && view.author.key === author.key) {
        option.selected = true;
      }
      userSwitch.appendChild(option);
    });
    
    // Обработчик изменения пользователя
    userSwitch._changeHandler = (event) => {
      const selectedKey = event.target.value;
      const allAuthors = collectAllAuthors();
      const selectedAuthor = allAuthors.find(a => a.key === selectedKey);
      if (selectedAuthor && (!view.author || view.author.key !== selectedKey)) {
        toggleFilter(selectedAuthor.key, selectedAuthor.displayName);
      }
    };
    userSwitch.addEventListener("change", userSwitch._changeHandler);
    
    userSwitchContainer.appendChild(userSwitch);
    container.appendChild(userSwitchContainer);

    const hint = document.createElement("p");
    hint.className = "pd-keyword-hint";
    hint.textContent =
      "Введите одно или несколько слов (можно через запятую). Будут показаны сообщения, где встречается хотя бы одно из них.";
    container.appendChild(hint);

    const form = document.createElement("form");
    form.className = "pd-keyword-form";
    container.appendChild(form);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "pd-keyword-input";
    input.placeholder = "Например: голосование, защита, проверка";
    form.appendChild(input);

    const applyButton = document.createElement("button");
    applyButton.type = "submit";
    applyButton.className = "pd-keyword-apply";
    applyButton.textContent = "Применить";
    form.appendChild(applyButton);

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "pd-keyword-reset";
    resetButton.textContent = "Сбросить слова";
    resetButton.addEventListener("click", () => {
      input.value = "";
      setKeywordFilter(view, [], "");
    });
    form.appendChild(resetButton);

    const status = document.createElement("div");
    status.className = "pd-keyword-status";
    container.appendChild(status);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      applyKeywordFilterFromInput(view);
    });

    anchorNode.parentElement?.insertBefore(container, anchorNode);

    return {
      container,
      input,
      status,
      userSwitch,
      userSwitchContainer
    };
  }
  
  function updateUserSwitchList() {
    if (!STATE.filteredView?.keywordControls?.userSwitch) {
      return;
    }
    
    const userSwitch = STATE.filteredView.keywordControls.userSwitch;
    const currentValue = userSwitch.value;
    const allAuthors = collectAllAuthors();
    
    // Очищаем список
    userSwitch.innerHTML = "";
    
    // Заполняем новыми данными
    allAuthors.forEach((author) => {
      const option = document.createElement("option");
      option.value = author.key;
      option.textContent = author.displayName;
      if (STATE.activeFilter && STATE.activeFilter.key === author.key) {
        option.selected = true;
      } else if (currentValue === author.key) {
        option.selected = true;
      }
      userSwitch.appendChild(option);
    });
    
    // Обновляем обработчик события, так как список изменился
    userSwitch.removeEventListener("change", userSwitch._changeHandler);
    userSwitch._changeHandler = (event) => {
      const selectedKey = event.target.value;
      const selectedAuthor = allAuthors.find(a => a.key === selectedKey);
      if (selectedAuthor && (!STATE.activeFilter || STATE.activeFilter.key !== selectedKey)) {
        toggleFilter(selectedAuthor.key, selectedAuthor.displayName);
      }
    };
    userSwitch.addEventListener("change", userSwitch._changeHandler);
  }

  function initializeKeywordControls(view) {
    if (!view?.keywordControls) {
      return;
    }
    const keywords = Array.isArray(STATE.activeFilter?.keywords)
      ? [...STATE.activeFilter.keywords]
      : [];
    view.keywords = keywords;
    const rawValue =
      typeof STATE.activeFilter?.keywordInput === "string"
        ? STATE.activeFilter.keywordInput
        : "";
    if (view.keywordControls.input) {
      view.keywordControls.input.value = rawValue;
    }
    
    // Обновляем выбранного пользователя в выпадающем списке
    if (view.keywordControls.userSwitch && view.author) {
      view.keywordControls.userSwitch.value = view.author.key;
    }
    
    renderKeywordStatus(view);
  }

  function applyKeywordFilterFromInput(view) {
    if (!view?.keywordControls?.input) {
      return;
    }
    const rawValue = view.keywordControls.input.value || "";
    const keywords = parseKeywords(rawValue);
    setKeywordFilter(view, keywords, rawValue);
  }

  function setKeywordFilter(view, keywords, rawValue = null) {
    if (!view) {
      return;
    }
    const normalized = Array.from(
      new Set(
        (keywords || [])
          .map((word) => normalizeKeyword(word))
          .filter(Boolean)
      )
    );
    view.keywords = normalized;
    if (STATE.activeFilter) {
      STATE.activeFilter.keywords = normalized;
      if (rawValue !== null) {
        STATE.activeFilter.keywordInput = rawValue;
      }
      STATE.activeFilter.awaitingApply = false;
    }
    if (rawValue !== null && view.keywordControls?.input) {
      view.keywordControls.input.value = rawValue;
    }
    view.currentPage = 1;
    view.awaitingApply = false;
    renderKeywordStatus(view);
    renderFilteredResults(view);
    updateBanner();

    if (!view.collector) {
      collectFilteredPosts(view);
    }
  }

  function renderKeywordStatus(view) {
    const statusNode = view.keywordControls?.status;
    if (!statusNode) {
      return;
    }
    if (view.awaitingApply) {
      statusNode.textContent =
        "Введите ключевые слова и нажмите «Применить», чтобы начать (оставьте поле пустым, чтобы показать все сообщения).";
      return;
    }
    if (!view.keywords?.length) {
      statusNode.textContent = "Слова не заданы — отображаются все сообщения пользователя.";
      return;
    }
    statusNode.textContent = `Активные слова: ${view.keywords.join(
      ", "
    )}. Сообщения должны содержать хотя бы одно из них.`;
  }

  function parseKeywords(rawValue) {
    if (!rawValue) {
      return [];
    }
    return rawValue
      .split(/[,;\n]/)
      .map((word) => normalizeKeyword(word))
      .filter(Boolean);
  }

  function normalizeKeyword(word) {
    return word.trim().replace(/\s+/g, " ").toLowerCase();
  }

  function formatKeywordSummary(keywords) {
    if (!Array.isArray(keywords) || !keywords.length) {
      return "";
    }
    const preview = keywords.slice(0, 3).join(", ");
    return keywords.length > 3 ? `${preview}…` : preview;
  }

  function normalizePostText(value) {
    return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function extractSearchableText(article) {
    if (!(article instanceof HTMLElement)) {
      return "";
    }
    const commentContent = article.querySelector("[data-role='commentContent']");
    const sourceNode = commentContent ? commentContent.cloneNode(true) : article.cloneNode(true);
    if (!sourceNode) {
      return "";
    }
    sourceNode.querySelectorAll("blockquote").forEach((quote) => quote.remove());
    return normalizePostText(sourceNode.textContent || "");
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

  async function collectAllPosts() {
    
    const pageInfo = getPageInfo();
    if (!pageInfo) {
      return Promise.resolve();
    }
    
    if (STATE.allPostsCollector && !STATE.allPostsCollected) {
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (STATE.allPostsCollected || !STATE.allPostsCollector) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
      });
    }
    
    if (STATE.allPostsCollected) {
      return Promise.resolve();
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

    STATE.allPostsCollector = collectorState;
    STATE.allPosts = [];

    
    const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, traversal.length);
    const workers = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(runAllPostsCollectorWorker(collectorState));
    }

    await Promise.all(workers);
    collectorState.active = false;
    STATE.allPostsCollected = true;
    STATE.allPostsCollector = null;
    
    STATE.allPosts.sort((a, b) => a.order - b.order);
    
    updateUserSwitchList();
    
    updateBanner();
  }

  async function runAllPostsCollectorWorker(collectorState) {
    while (true) {
      if (collectorState.cancelled) {
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
          continue;
        }
        root = collectorState.parser.parseFromString(html, "text/html");
      }

      const posts = extractAllPosts(root, pageNumber);
      let added = 0;
      posts.forEach((post) => {
        if (!post.commentId || collectorState.seen.has(post.commentId)) {
          return;
        }
        collectorState.seen.add(post.commentId);
        STATE.allPosts.push(post);
        added += 1;
      });

      collectorState.processed += 1;
      
      updateAllPostsProgress();
      
      if (added > 0 && (collectorState.processed % 5 === 0 || collectorState.processed === 1)) {
        updateUserSwitchList();
      }

      await waitForNextFrame();
    }
  }
  
  function updateAllPostsProgress() {
    if (!STATE.filteredView || !STATE.allPostsCollector) {
      return;
    }
    
    const view = STATE.filteredView;
    const processed = STATE.allPostsCollector.processed || 0;
    const total = STATE.allPostsCollector.total || "?";
    const posts = STATE.allPosts.length || 0;
    const message = `Обработано страниц: ${processed}/${total}. Найдено сообщений: ${posts}`;
    
    if (view.summaryNode) {
      view.summaryNode.textContent = `Сбор постов со всех страниц: ${message}`;
    }
    
    if (view.resultsNode) {
      view.resultsNode.innerHTML = `<div class="pd-filter-loading">${message}</div>`;
    }
    
    updateBanner();
  }

  async function collectFilteredPosts(view) {
    if (STATE.allPostsCollected) {
      filterPostsByUser(view, view.author.key);
      renderFilteredResults(view);
      updateBanner();
      return;
    }

    if (STATE.allPostsCollector) {
      await collectAllPosts();
      filterPostsByUser(view, view.author.key);
      renderFilteredResults(view);
      updateBanner();
      return;
    }

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
    if (STATE.allPostsCollector && !STATE.allPostsCollected) {
      const processed = STATE.allPostsCollector.processed || 0;
      const total = STATE.allPostsCollector.total || "?";
      const posts = STATE.allPosts.length || 0;
      return `Обработано страниц: ${processed}/${total}. Найдено сообщений: ${posts}`;
    }
    
    const processed = view?.collector?.processed || 0;
    const total = view?.collector?.total || "?";
    const posts = view?.posts?.length || 0;
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
        for (let page = 1; page <= total; page += 1) {
          push(page);
        }
      }
    }

    return order;
  }

  function redirectToFirstPage(userKey, username) {
    const pagination = document.querySelector(".ipsPagination[data-pages]");
    const currentPage = detectCurrentPageNumber(pagination);
    if (currentPage <= 1) {
      return false;
    }

    const payload = {
      key: userKey,
      username,
      keywords: [],
      keywordInput: "",
      awaitingApply: true,
      timestamp: Date.now()
    };

    try {
      sessionStorage.setItem(PENDING_FILTER_KEY, JSON.stringify(payload));
    } catch (err) {
    }

    const pageInfo = getPageInfo();
    const targetUrl = buildPageUrl(1, pageInfo);
    window.location.assign(targetUrl);
    return true;
  }

  function restorePendingFilterIfNeeded() {
    let raw;
    try {
      raw = sessionStorage.getItem(PENDING_FILTER_KEY);
    } catch (err) {
      raw = null;
    }

    if (!raw) {
      return;
    }

    try {
      sessionStorage.removeItem(PENDING_FILTER_KEY);
    } catch (err) {
    }

    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      data = null;
    }

    if (
      !data ||
      !data.key ||
      !data.username ||
      !data.timestamp ||
      Date.now() - data.timestamp > PENDING_FILTER_TTL
    ) {
      return;
    }

    const pageInfo = getPageInfo();
    if (!pageInfo || pageInfo.currentPage !== 1) {
      return;
    }

    STATE.activeFilter = {
      key: data.key,
      username: data.username,
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      keywordInput: typeof data.keywordInput === "string" ? data.keywordInput : "",
      awaitingApply: data.awaitingApply === false ? false : true
    };
    
    if (!STATE.allPostsCollected && !STATE.allPostsCollector) {
      startLoadingMode();
      collectAllPosts().then(() => {
        if (STATE.activeFilter) {
          startFilteredMode();
        }
      });
    } else if (STATE.allPostsCollector && !STATE.allPostsCollected) {
      startLoadingMode();
      collectAllPosts().then(() => {
        if (STATE.activeFilter) {
          startFilteredMode();
        }
      });
    } else {
      startFilteredMode();
      const form = document.querySelector(".pd-keyword-form");
      form.submit();
    }
  }

  function extractAllPosts(root, pageNumber) {
    if (!root || typeof root.querySelectorAll !== "function") {
      return [];
    }

    const posts = [];
    root.querySelectorAll(POST_SELECTOR).forEach((article, index) => {
      const author = extractAuthor(article);
      if (!author || !author.key) {
        return;
      }
      const commentNode = article.querySelector("[data-commentid]");
      const commentId = commentNode?.dataset.commentid || article.id || `${pageNumber}_${index}`;
      const anchor = `<a id="comment-${commentId}"></a>`;
      const clone = document.importNode(article, true);
      normalizeEmbeddedMedia(clone);
      const textContent = extractSearchableText(article);
      if (clone.dataset) {
        delete clone.dataset.pdEnhanced;
        delete clone.dataset.pdUserKey;
        delete clone.dataset.pdUserName;
      }
      clone.classList?.remove("pd-post-hidden", "pd-post-highlight");
      const wrapper = document.createElement("div");
      wrapper.appendChild(clone);
      posts.push({
        commentId,
        pageNumber,
        order: pageNumber * 1000 + index,
        html: `${anchor}${wrapper.innerHTML}`,
        text: textContent,
        authorKey: author.key,
        authorName: author.displayName
      });
    });
    return posts;
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
      const clone = document.importNode(article, true);
      normalizeEmbeddedMedia(clone);
      const textContent = extractSearchableText(article);
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
        html: `${anchor}${wrapper.innerHTML}`,
        text: textContent,
        authorKey: author.key,
        authorName: author.displayName
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
    const signature = `${window.location.pathname}|${window.location.search}`;
    if (STATE.pageInfo?.signature === signature) {
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

    const currentPage = detectCurrentPageNumber(pagination);

    const url = new URL(window.location.href);
    const matchBase = url.pathname.match(/(.*?\/topic\/\d+)/);
    const baseUrl = `${url.origin}${matchBase ? matchBase[1] : url.pathname}`.replace(/\/$/, "");

    STATE.pageInfo = {
      signature,
      baseUrl,
      totalPages,
      currentPage,
      tab: url.searchParams.get("tab")
    };
    return STATE.pageInfo;
  }

  function detectCurrentPageNumber(paginationEl) {
    let currentPage = parseInt(
      paginationEl?.querySelector(".ipsPagination_active a[data-page]")?.dataset.page || "",
      10
    );
    if (Number.isNaN(currentPage) || currentPage < 1) {
      const match = window.location.pathname.match(/\/page\/(\d+)/);
      currentPage = match ? parseInt(match[1], 10) : 1;
    }
    return currentPage;
  }

  function getVisiblePosts(view) {
    if (!view) {
      return [];
    }
    if (!view.keywords?.length) {
      return view.posts;
    }
    return view.posts.filter((post) => postMatchesKeywords(post, view.keywords));
  }

  function postMatchesKeywords(post, keywords) {
    if (!keywords?.length) {
      return true;
    }
    const text = post?.text || "";
    if (!text) {
      return false;
    }
    return keywords.some((keyword) => text.includes(keyword));
  }

  function renderFilteredResults(view) {
    if (!view || view.cancelled) {
      return;
    }

    if (view.awaitingApply) {
      if (view.resultsNode) {
        view.resultsNode.innerHTML =
          `<div class="pd-filter-empty">Введите ключевые слова и нажмите «Применить», чтобы загрузить сообщения пользователя или оставьте поле пустым для показа всех постов.</div>`;
      }
      view.paginationNodes?.forEach((node) => {
        node.innerHTML = "";
      });
      setFilteredSummary(view, { totalPosts: 0, isLoading: Boolean(view.collector?.active) });
      updateBanner();
      return;
    }

    const visiblePosts = getVisiblePosts(view);
    const totalPosts = visiblePosts.length;
    view.totalPages = Math.max(1, Math.ceil(totalPosts / view.perPage));
    view.currentPage = Math.min(view.currentPage, view.totalPages);

    const startIndex = (view.currentPage - 1) * view.perPage;
    const slice = visiblePosts.slice(startIndex, startIndex + view.perPage);

    if (slice.length === 0) {
      if (view.collector?.active) {
        view.resultsNode.innerHTML = `<div class="pd-filter-loading">Эта страница ещё загружается…</div>`;
      } else {
        view.resultsNode.innerHTML = `<div class="pd-filter-empty">Сообщения отсутствуют на этой странице.</div>`;
      }
    } else {
      view.resultsNode.innerHTML = slice.map((post) => post.html).join("");
      enhancePosts(view.resultsNode);
      hydrateEmbeddedContent(view.resultsNode);
      applyQuoteMinimizer(view.resultsNode);
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
    const totalAuthored = view.posts.length;
    const hasKeywords = Boolean(view.keywords?.length);
    const keywordPart = hasKeywords ? ` · ключевые слова: ${view.keywords.join(", ")}` : "";

    if (view.awaitingApply) {
      const suffix = view.collector?.active ? " · подготовка…" : "";
      view.summaryNode.textContent = `${base} · введите ключевые слова и нажмите «Применить»${suffix}`;
      return;
    }

    if (!hasKeywords) {
      if (!totalPosts) {
        const suffix = isLoading ? ` · ${buildProgressMessage(view)}` : " · сообщений нет";
        view.summaryNode.textContent = `${base}${suffix}`;
        return;
      }
    }

    if (!totalPosts) {
      let suffix;
      if (isLoading) {
        suffix = ` · ${buildProgressMessage(view)}`;
      } else if (hasKeywords && totalAuthored) {
        suffix = " · нет сообщений с такими словами";
      } else {
        suffix = " · сообщений нет";
      }
      view.summaryNode.textContent = `${base}${suffix}${keywordPart}`;
      return;
    }

    const totalPart =
      totalAuthored === totalPosts
        ? ` · всего ${totalPosts}`
        : ` · показано ${totalPosts} из ${totalAuthored}`;
    const pagePart = ` · страница ${view.currentPage} из ${view.totalPages}`;
    const progressPart = isLoading ? ` · ${buildProgressMessage(view)}` : "";
    view.summaryNode.textContent = `${base}${totalPart}${pagePart}${keywordPart}${progressPart}`;
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

  function normalizeEmbeddedMedia(container) {
    if (!container?.querySelectorAll) {
      return;
    }

    container.querySelectorAll("img").forEach((img) => {
      const dataSrc = img.getAttribute("data-src") || img.getAttribute("data-original") || img.dataset?.src;
      if (dataSrc) {
        if (!img.getAttribute("src") || /spacer\.png$/i.test(img.getAttribute("src"))) {
          img.setAttribute("src", dataSrc);
        }
      }
      const dataSrcSet = img.getAttribute("data-srcset") || img.dataset?.srcset;
      if (dataSrcSet) {
        img.setAttribute("srcset", dataSrcSet);
      }
    });

    container.querySelectorAll("iframe[data-src]").forEach((iframe) => {
      if (!iframe.getAttribute("src")) {
        iframe.setAttribute("src", iframe.getAttribute("data-src"));
      }
    });
  }

  function hydrateEmbeddedContent(container) {
    if (!container) {
      return;
    }

    try {
      if (window.ips?.utils?.lazyLoad?.process) {
        window.ips.utils.lazyLoad.process();
      }
    } catch (err) {
      // ignore
    }

    if (window.jQuery) {
      try {
        const $container = window.jQuery(container);
        window.jQuery(document).trigger("contentChange", [$container]);
        window.jQuery(document).trigger("contentAdded", [$container]);
      } catch (err) {
        // ignore
      }
    }
  }

  function applyQuoteMinimizer(container) {
    if (!container?.querySelectorAll) {
      return;
    }

    container.querySelectorAll("blockquote.ipsQuote").forEach((quote) => {
      if (quote.dataset.pdQuoteProcessed === "true") {
        return;
      }

      const contents = quote.querySelector(".ipsQuote_contents");
      if (!contents) {
        return;
      }

      quote.dataset.pdQuoteProcessed = "true";
      const toggleLink =
        quote.querySelector(".ipsQuote_citation [data-action='toggleQuote']") ||
        createQuoteToggle(quote);
      const startCollapsed = shouldCollapseQuote(contents);
      setQuoteCollapsed(quote, startCollapsed);

      if (toggleLink && !toggleLink.dataset.pdToggleBound) {
        toggleLink.dataset.pdToggleBound = "true";
        toggleLink.addEventListener("click", (event) => {
          event.preventDefault();
          const collapsed = quote.classList.contains("pd-quote-collapsed");
          setQuoteCollapsed(quote, !collapsed);
        });
      }
    });
  }

  function shouldCollapseQuote(contents) {
    const text = contents.textContent || "";
    const lines = text.split(/\n+/).filter((line) => line.trim().length).length;
    const hasNested = Boolean(contents.querySelector(".ipsQuote"));
    return (
      hasNested ||
      lines >= QUOTE_COLLAPSE_MIN_LINES ||
      text.length >= QUOTE_COLLAPSE_MIN_LENGTH
    );
  }

  function setQuoteCollapsed(quote, collapsed) {
    const citation = quote.querySelector(".ipsQuote_citation");
    const contents = quote.querySelector(".ipsQuote_contents");
    if (!citation || !contents) {
      return;
    }

    if (collapsed) {
      citation.classList.add("ipsQuote_closed");
      citation.classList.remove("ipsQuote_open");
      contents.style.display = "none";
      contents.setAttribute("data-minimizedQuoteWasHere", "1");
      quote.classList.add("pd-quote-collapsed");
    } else {
      citation.classList.add("ipsQuote_open");
      citation.classList.remove("ipsQuote_closed");
      contents.style.display = "block";
      contents.setAttribute("animating", "false");
      quote.classList.remove("pd-quote-collapsed");
    }
  }

  function createQuoteToggle(quote) {
    const citation = quote.querySelector(".ipsQuote_citation");
    if (!citation) {
      return null;
    }

    const link = document.createElement("a");
    link.href = "#";
    link.dataset.action = "toggleQuote";
    link.innerHTML = "&nbsp;";
    citation.insertBefore(link, citation.firstChild || null);
    return link;
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
    if (STATE.activeFilter.awaitingApply) {
      // Если идет сбор всех постов, показываем это
      if (STATE.allPostsCollector && !STATE.allPostsCollected) {
        label.textContent = `Сбор постов со всех страниц: ${buildProgressMessage(view)}`;
      } else {
        label.textContent = `Пользователь ${STATE.activeFilter.username} · введите ключевые слова и нажмите «Применить»`;
      }
      return;
    }
    const keywordsSummary = formatKeywordSummary(STATE.activeFilter.keywords);
    const keywordSuffix = keywordsSummary ? ` · слова: ${keywordsSummary}` : "";
    
    // Если идет сбор всех постов, показываем его прогресс
    if (STATE.allPostsCollector && !STATE.allPostsCollected) {
      label.textContent = `Сбор постов со всех страниц: ${buildProgressMessage(view)}`;
      return;
    }
    
    if (view?.collector?.active) {
      label.textContent = `Пользователь ${STATE.activeFilter.username} · ${buildProgressMessage(
        view
      )}${keywordSuffix}`;
      return;
    }

    const visibleCount = view ? getVisiblePosts(view).length : 0;
    const totalCount = view?.posts.length || 0;

    if (visibleCount) {
      const countPart =
        totalCount === visibleCount
          ? `${visibleCount} сообщений`
          : `${visibleCount} из ${totalCount} сообщений`;
      label.textContent = `Пользователь ${STATE.activeFilter.username} · ${countPart} · страница ${view.currentPage}/${view.totalPages}${keywordSuffix}`;
      return;
    }

    if (totalCount && STATE.activeFilter?.keywords?.length) {
      label.textContent = `У пользователя ${STATE.activeFilter.username} нет сообщений с такими словами${keywordSuffix}`;
      return;
    }

    label.textContent = `У пользователя ${STATE.activeFilter.username} нет сообщений в этой теме`;
  }

  function updateUIState() {
    document
      .querySelectorAll(POST_SELECTOR)
      .forEach(applyCurrentFilterToPost);
    updateButtonStates();
    updateBanner();
  }

  function ensureLikesButton() {
    if (document.getElementById("pd-likes-button")) {
      return;
    }

    if (!window.location.pathname.includes("/topic/")) {
      return;
    }

    const feed = document.getElementById(TOPIC_FEED_ID);
    if (!feed) {
      return;
    }

    const container = document.createElement("div");
    container.className = "pd-likes-button-container";

    const button = document.createElement("button");
    button.id = "pd-likes-button";
    button.type = "button";
    button.className = "pd-likes-button";
    button.textContent = "<3";
    button.addEventListener("click", () => {
      collectAndDisplayLikes();
    });

    container.appendChild(button);
    feed.insertAdjacentElement("beforebegin", container);
  }

  async function collectAndDisplayLikes() {
    const button = document.getElementById("pd-likes-button");
    if (button) {
      button.disabled = true;
      button.textContent = "Собираю лайки...";
    }

    const pageInfo = getPageInfo();
    if (!pageInfo) {
      alert("Не удалось определить информацию о страницах");
      if (button) {
        button.disabled = false;
        button.textContent = "<3";
      }
      return;
    }

    const allLikes = [];
    const parser = new DOMParser();
    const pages = Array.from({ length: pageInfo.totalPages }, (_, i) => i + 1);
    let processed = 0;
    let currentIndex = 0;

    async function processPage(pageNum) {
      let root = null;
      if (pageNum === pageInfo.currentPage) {
        root = document;
      } else {
        const html = await fetchPageHtml(buildPageUrl(pageNum, pageInfo));
        if (!html) {
          return;
        }
        root = parser.parseFromString(html, "text/html");
      }

      const pageLikes = parseLikesFromPage(root, pageNum);
      allLikes.push(...pageLikes);

      processed += 1;
      if (button) {
        button.textContent = `Обработано: ${processed}/${pageInfo.totalPages}`;
      }
    }

    const workers = [];
    const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, pages.length);

    for (let i = 0; i < workerCount; i += 1) {
      workers.push(
        (async () => {
          while (currentIndex < pages.length) {
            const pageNum = pages[currentIndex];
            currentIndex += 1;
            await processPage(pageNum);
            await waitForNextFrame();
          }
        })()
      );
    }

    await Promise.all(workers);

    allLikes.sort((a, b) => b.timestamp - a.timestamp);
    displayLikesList(allLikes);

    if (button) {
      button.disabled = false;
      button.textContent = "<3";
    }
  }

  function parseLikesFromPage(root, pageNum) {
    const likes = [];
    if (!root || typeof root.querySelectorAll !== "function") {
      return likes;
    }

    root.querySelectorAll(POST_SELECTOR).forEach((article) => {
      const commentId = article.querySelector("[data-commentid]")?.dataset.commentid;
      if (!commentId) {
        return;
      }

      const postText = extractPostTextWithoutQuotes(article);
      const postTime = extractPostTime(article);
      const postUser = extractPostUser(article);
      const postPage = pageNum ? String(pageNum) : "";

      const reactionBlurb = article.querySelector('[data-role="reactionBlurb"]');
      if (!reactionBlurb || reactionBlurb.classList.contains("ipsHide")) {
        return;
      }

      const reactionText = reactionBlurb.textContent || reactionBlurb.innerText || "";
      if (!reactionText || !reactionText.includes("понравилось")) {
        return;
      }

      const users = extractUsersFromReaction(reactionText);
      if (users.length === 0) {
        return;
      }

      users.forEach((username) => {
        likes.push({
          username,
          postUser,
          postText,
          postTime,
          postPage,
          timestamp: postTime ? parseTimeToTimestamp(postTime) : Date.now(),
          commentId
        });
      });
    });

    return likes;
  }

  function extractPostTextWithoutQuotes(article) {
    return extractSearchableText(article);
  }

  function extractPostTime(article) {
    const timeNode = article.querySelector("time[datetime]");
    if (timeNode) {
      const datetime = timeNode.getAttribute("datetime");
      if (datetime) {
        return new Date(datetime).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
      }
    }
    

    const timeText = article.querySelector("time")?.textContent?.trim();
    if (timeText) {
      return timeText;
    }

    return "";
  }

  function extractPostUser(article) {
    const author = extractAuthor(article);
    return author?.displayName || "";
  }

  function parseTimeToTimestamp(timeStr) {
    if (!timeStr) {
      return Date.now();
    }

    try {
      const date = new Date(timeStr);
      if (!Number.isNaN(date.getTime())) {
        return date.getTime();
      }
    } catch (err) {
      // ignore
    }

    const now = Date.now();
    const relativeMatch = timeStr.match(/(\d+)\s*(минут|час|день|недел|месяц)/i);
    if (relativeMatch) {
      const value = parseInt(relativeMatch[1], 10);
      const unit = relativeMatch[2].toLowerCase();
      let ms = 0;
      if (unit.includes("минут")) {
        ms = value * 60 * 1000;
      } else if (unit.includes("час")) {
        ms = value * 60 * 60 * 1000;
      } else if (unit.includes("день")) {
        ms = value * 24 * 60 * 60 * 1000;
      } else if (unit.includes("недел")) {
        ms = value * 7 * 24 * 60 * 60 * 1000;
      } else if (unit.includes("месяц")) {
        ms = value * 30 * 24 * 60 * 60 * 1000;
      }
      return now - ms;
    }

    return now;
  }

  function extractUsersFromReaction(reactionText) {
    const users = [];
    if (!reactionText) {
      return users;
    }

    const match = reactionText.match(/понравилось это/i);
    if (!match) {
      return users;
    }

    const beforeText = reactionText.split(/понравилось это/i)[0].trim();
    if (!beforeText) {
      return users;
    }

    const names = beforeText
      .split(/\s+и\s+/i)
      .flatMap((part) => part.split(/,\s*/))
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !/^и$/i.test(name));

    return names.length > 0 ? names : [beforeText];
  }

  function displayLikesList(likes) {
    const existing = document.getElementById("pd-likes-list");
    if (existing) {
      existing.remove();
    }

    const container = document.createElement("div");
    container.id = "pd-likes-list";
    container.className = "pd-likes-list";

    const allLikes = sortByPostTimeAscending([...likes]);
    allLikes.reverse();

    const uniqueLikers = Array.from(new Set(likes.map((l) => l.username).filter(Boolean))).sort().filter((liker) => !liker.includes("друг"));
    const uniquePostUsers = Array.from(new Set(likes.map((l) => l.postUser).filter(Boolean))).sort();

    const header = document.createElement("div");
    header.className = "pd-likes-header";
    header.innerHTML = `
      <h3>Все лайки в топике (${likes.length})</h3>
      <button type="button" class="pd-likes-close">×</button>
    `;
    header.querySelector(".pd-likes-close").addEventListener("click", () => {
      container.remove();
    });
    container.appendChild(header);

    const filtersContainer = document.createElement("div");
    filtersContainer.className = "pd-likes-filters";

    const filterLiker = document.createElement("div");
    filterLiker.className = "pd-likes-filter-group";
    const labelLiker = document.createElement("label");
    labelLiker.textContent = "Лайки поставлен:";
    labelLiker.htmlFor = "pd-filter-liker";
    const selectLiker = document.createElement("select");
    selectLiker.id = "pd-filter-liker";
    selectLiker.className = "pd-likes-filter-select";
    const optionAllLiker = document.createElement("option");
    optionAllLiker.value = "";
    optionAllLiker.textContent = "Все";
    selectLiker.appendChild(optionAllLiker);
    uniqueLikers.forEach((username) => {
      const option = document.createElement("option");
      option.value = username;
      option.textContent = username;
      selectLiker.appendChild(option);
    });
    filterLiker.appendChild(labelLiker);
    filterLiker.appendChild(selectLiker);
    filtersContainer.appendChild(filterLiker);

    const filterPostUser = document.createElement("div");
    filterPostUser.className = "pd-likes-filter-group";
    const labelPostUser = document.createElement("label");
    labelPostUser.textContent = "Лайк получен:";
    labelPostUser.htmlFor = "pd-filter-post-user";
    const selectPostUser = document.createElement("select");
    selectPostUser.id = "pd-filter-post-user";
    selectPostUser.className = "pd-likes-filter-select";
    const optionAllPostUser = document.createElement("option");
    optionAllPostUser.value = "";
    optionAllPostUser.textContent = "Все";
    selectPostUser.appendChild(optionAllPostUser);
    uniquePostUsers.forEach((username) => {
      const option = document.createElement("option");
      option.value = username;
      option.textContent = username;
      selectPostUser.appendChild(option);
    });
    filterPostUser.appendChild(labelPostUser);
    filterPostUser.appendChild(selectPostUser);
    filtersContainer.appendChild(filterPostUser);

    container.appendChild(filtersContainer);

    const list = document.createElement("div");
    list.className = "pd-likes-items";

    function renderFilteredLikes() {
      const selectedLiker = selectLiker.value;
      const selectedPostUser = selectPostUser.value;

      const filtered = allLikes.filter((like) => {
        const matchesLiker = !selectedLiker || like.username === selectedLiker;
        const matchesPostUser = !selectedPostUser || like.postUser === selectedPostUser;
        return matchesLiker && matchesPostUser;
      });

      list.innerHTML = "";

      if (filtered.length === 0) {
        list.innerHTML = '<div class="pd-likes-empty">Лайков не найдено</div>';
      } else {
        filtered.forEach((like) => {
          const item = document.createElement("div");
          item.className = "pd-likes-item";
          item.style.cursor = "pointer";
          const postPreview = like.postText.length > 100
            ? `${like.postText.substring(0, 100)}...`
            : like.postText;
          item.innerHTML = `
            <div class="pd-likes-user"><strong>${escapeHtml(like.username)}</strong> поставил лайк на пост пользователя <strong>${escapeHtml(like.postUser)}</strong>:</div>
            <div class="pd-likes-page">на странице ${escapeHtml(like.postPage)}</div>
            <div class="pd-likes-post">"${escapeHtml(postPreview)}"</div>
            <div class="pd-likes-time">в ${escapeHtml(like.postTime || "неизвестное время")}</div>
          `;
          item.addEventListener("click", () => {
            container.remove();
            if (like.commentId) {
              const pageInfo = getPageInfo();
              if (pageInfo) {
                const url = `${pageInfo.baseUrl}?do=findComment&comment=${like.commentId}`;
                window.location.href = url;
              } else {
                const anchor = `#comment-${like.commentId}`;
                const existingPost = document.querySelector(anchor);
                if (existingPost) {
                  existingPost.scrollIntoView({ behavior: "smooth", block: "center" });
                } else {
                  window.location.hash = anchor;
                }
              }
            }
          });
          list.appendChild(item);
        });
      }
    }

    const headerTitle = header.querySelector("h3");
    function updateHeader(count) {
      headerTitle.textContent = `Все лайки в топике (${count})`;
    }

    selectLiker.addEventListener("change", () => {
      renderFilteredLikes();
      const selectedLiker = selectLiker.value;
      const selectedPostUser = selectPostUser.value;
      const filtered = allLikes.filter((like) => {
        const matchesLiker = !selectedLiker || like.username === selectedLiker;
        const matchesPostUser = !selectedPostUser || like.postUser === selectedPostUser;
        return matchesLiker && matchesPostUser;
      });
      updateHeader(filtered.length);
    });

    selectPostUser.addEventListener("change", () => {
      renderFilteredLikes();
      const selectedLiker = selectLiker.value;
      const selectedPostUser = selectPostUser.value;
      const filtered = allLikes.filter((like) => {
        const matchesLiker = !selectedLiker || like.username === selectedLiker;
        const matchesPostUser = !selectedPostUser || like.postUser === selectedPostUser;
        return matchesLiker && matchesPostUser;
      });
      updateHeader(filtered.length);
    });

    container.appendChild(list);
    document.body.appendChild(container);

    renderFilteredLikes();
  }

  function parseDate(dateString) {
    const [datePart, timePart] = dateString.split(', ');
    const [day, month, year] = datePart.split('.');
    const [hour, minute] = timePart.split(':');
    
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
  }

  function sortByPostTimeAscending(arr) {
    const sortedArray = arr.sort((a, b) => {
      const dateA = parseDate(a.postTime);
      const dateB = parseDate(b.postTime);

      return dateA - dateB;
    });

    return sortedArray;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

