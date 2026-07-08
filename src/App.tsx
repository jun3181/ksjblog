import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const defaultCategories = [
  { id: "daily", label: "일상 게시판", groupType: "boards" },
  { id: "health", label: "헬스", groupType: "boards" },
  { id: "dev", label: "개발 게시판", groupType: "boards" },
  { id: "webtoon", label: "웹툰", groupType: "webtoon" },
];

const menuGroups = [
  { id: 1, label: "게시판", type: "boards" },
  { id: 2, label: "웹툰", type: "webtoon" },
  { id: 3, label: "다른 목록", type: "placeholder" },
];

const fonts = [
  { label: "기본", value: "Arial, 'Noto Sans KR', sans-serif" },
  { label: "명조", value: "Georgia, 'Noto Serif KR', serif" },
  { label: "둥근", value: "'Trebuchet MS', 'Noto Sans KR', sans-serif" },
];

const drawingTools = [
  { id: "brush", label: "브러쉬", shortcut: "B" },
  { id: "eraser", label: "지우개", shortcut: "E" },
  { id: "text", label: "텍스트", shortcut: "T" },
];

const youtubeRecommendationLinks = [
  // 여기에 유튜브 링크를 추가하세요. 매일 00시에 이 목록 중 하나가 추천됩니다.
  // "https://www.youtube.com/watch?v=VIDEO_ID",
  // { title: "노래 제목", url: "https://youtu.be/VIDEO_ID" },
  "https://www.youtube.com/watch?v=olzR1p2FhzY&list=RDolzR1p2FhzY&start_radio=1",
  "https://www.youtube.com/watch?v=x0APPrPgexY&list=RDx0APPrPgexY&start_radio=1",
  "https://youtu.be/75tBY-gOcoQ?si=uB5VLONH4ihoOnYt",
  "https://youtu.be/UZxzIFIM0mY?si=xf9CIWkRtT_tIywV",
];

const POSTS_STORAGE_KEY = "stack-chat-board-posts";
const CATEGORIES_STORAGE_KEY = "stack-chat-categories";
const POSTS_DB_NAME = "stack-chat-content";
const POSTS_DB_STORE = "posts";
const AUTH_STORAGE_KEY = "stack-chat-authenticated";
const VISIT_STORAGE_KEY = "stack-chat-visit-count";
const VISIT_SESSION_KEY = "stack-chat-visited-session";
const DEFAULT_DRAWING_HEIGHT = 420;
const DRAWING_HEIGHT_STEP = 80;
const MIN_DRAWING_HEIGHT = 260;
const MAX_DRAWING_HEIGHT = 740;

function createBlockId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createTextBlock(content = "") {
  return { id: createBlockId("text"), type: "text", content };
}

function createDrawingBlock(src = "", height = DEFAULT_DRAWING_HEIGHT) {
  return { id: createBlockId("drawing"), type: "drawing", src, height };
}

function createImageBlock(src = "") {
  return { id: createBlockId("image"), type: "image", src };
}

function getPostBlocks(post) {
  if (Array.isArray(post.blocks)) return post.blocks;

  const blocks = [];
  if (post.image) blocks.push({ id: "legacy-image", type: "image", src: post.image });
  if (post.drawing) blocks.push({ id: "legacy-drawing", type: "drawing", src: post.drawing, height: DEFAULT_DRAWING_HEIGHT });
  if (post.content) blocks.push({ id: "legacy-text", type: "text", content: post.content });
  return blocks;
}

function getTextContent(blocks) {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join("\n\n");
}

function getInitialVisitCount() {
  const storedCount = Number(window.localStorage.getItem(VISIT_STORAGE_KEY));
  return Number.isFinite(storedCount) ? storedCount : 0;
}

async function recordVisit() {
  const response = await fetch("/api/visits", { method: "POST" });
  if (!response.ok) throw new Error("Failed to record visit");

  const result = await response.json();
  const count = Number(result.count);
  if (!Number.isFinite(count)) throw new Error("Invalid visit count");

  return count;
}

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMillisecondsUntilNextMidnight() {
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1000, nextMidnight.getTime() - now.getTime() + 1000);
}

function getDateSeed(dateKey) {
  return dateKey.split("").reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

function getYoutubeVideoId(url) {
  if (!url) return "";

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") return parsedUrl.pathname.split("/").filter(Boolean)[0] || "";

    if (hostname.endsWith("youtube.com")) {
      if (parsedUrl.pathname === "/watch") return parsedUrl.searchParams.get("v") || "";

      const pathMatch = parsedUrl.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      if (pathMatch) return pathMatch[1];
    }
  } catch {
    const rawMatch = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([^&/?#]+)/);
    return rawMatch?.[1] || "";
  }

  return "";
}

function normalizeRecommendationLink(recommendation) {
  const url = typeof recommendation === "string" ? recommendation : recommendation.url;
  const title = typeof recommendation === "string" ? "" : recommendation.title || "";
  const videoId = getYoutubeVideoId(url);

  if (!url || !videoId) return null;

  return {
    title,
    url,
    videoId,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
  };
}

function getDailyRecommendedSong(dateKey) {
  const songs = youtubeRecommendationLinks
    .map(normalizeRecommendationLink)
    .filter(Boolean);

  if (!songs.length) return null;

  return songs[getDateSeed(dateKey) % songs.length];
}

function loadStoredPosts() {
  const removedSamplePostIds = new Set([101, 102, 103]);
  const storedPosts = window.localStorage.getItem(POSTS_STORAGE_KEY);
  if (!storedPosts) return [];

  try {
    const parsedPosts = JSON.parse(storedPosts);
    return Array.isArray(parsedPosts)
      ? parsedPosts.filter((post) => !removedSamplePostIds.has(post.id))
      : [];
  } catch {
    return [];
  }
}

function openPostsDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(POSTS_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(POSTS_DB_STORE)) {
        request.result.createObjectStore(POSTS_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadPostsFromDatabase() {
  const database = await openPostsDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(POSTS_DB_STORE, "readonly")
      .objectStore(POSTS_DB_STORE)
      .get("all");
    request.onsuccess = () => {
      database.close();
      resolve(request.result);
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

async function savePostsToDatabase(posts) {
  const database = await openPostsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(POSTS_DB_STORE, "readwrite");
    transaction.objectStore(POSTS_DB_STORE).put(posts, "all");
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function loadStoredCategories() {
  const storedCategories = window.localStorage.getItem(CATEGORIES_STORAGE_KEY);
  if (!storedCategories) return defaultCategories;

  try {
    const parsedCategories = JSON.parse(storedCategories);
    return Array.isArray(parsedCategories) ? parsedCategories : defaultCategories;
  } catch {
    return defaultCategories;
  }
}

const APP_BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function normalizePath(pathname) {
  if (APP_BASE_PATH && pathname.startsWith(APP_BASE_PATH)) {
    return pathname.slice(APP_BASE_PATH.length) || "/";
  }

  return pathname.replace(/^\/(?:website|ksjblog|main)(?=\/|$)/, "") || "/";
}

function getBrowserPath(nextPath) {
  if (!APP_BASE_PATH) return nextPath;
  if (nextPath === "/") return APP_BASE_PATH || "/";
  return `${APP_BASE_PATH}${nextPath}`;
}

function usePath() {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = useCallback((nextPath) => {
    window.history.pushState({}, "", getBrowserPath(nextPath));
    setPath(nextPath);
  }, []);

  return { path, navigate };
}

function BoardSidebar({ activeCategoryId, categories, isHomeActive, isLoggedIn, navigate, onCreateCategory }) {
  return (
    <aside className="board-sidebar" aria-label="왼쪽 메뉴">
      <nav className="menu-list" aria-label="전체 목록">
        <button className={`menu-title home-menu-button ${isHomeActive ? "is-selected" : ""}`} type="button" onClick={() => navigate("/")}>
          <span>메인</span>
        </button>
        {menuGroups.map((group) => (
          <section className="menu-group" key={`${group.id}-${group.label}`}>
            <button
              className={`menu-title ${
                group.type === "webtoon"
                && categories.some((category) => category.id === activeCategoryId && category.groupType === "webtoon")
                  ? "is-selected"
                  : ""
              }`}
              type="button"
              onClick={() => {
                if (group.type === "boards") navigate("/boards/daily");
                if (group.type === "webtoon") navigate("/boards/webtoon");
              }}
            >
              <span>{group.id}. {group.label}</span>
            </button>

            {(group.type === "boards" || group.type === "webtoon") && (
              <div className="board-list" aria-label="게시판 세부 목록">
                {categories
                  .filter((category) => category.groupType === group.type && category.id !== "webtoon")
                  .map((category) => (
                  <button
                    key={category.id}
                    className={`board-list-item ${!isHomeActive && category.id === activeCategoryId ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => navigate(`/boards/${category.id}`)}
                  >
                    <span>- {category.label}</span>
                  </button>
                ))}
                {isLoggedIn && (
                  <button className="create-category-button" type="button" onClick={() => onCreateCategory(group.type)}>
                    + 세부 목록 만들기
                  </button>
                )}
              </div>
            )}
          </section>
        ))}
      </nav>
    </aside>
  );
}

function BlogLayout({ children, activeCategoryId, categories, isHomeActive, isLoggedIn, navigate, onCreateCategory }) {
  return (
    <div className="blog-page">
      <header className="blog-banner" aria-label="그림 배너">
        <img src={`${import.meta.env.BASE_URL}images/forest-banner.png`} alt="숲길 배경에 블로그 문구가 들어간 배너" />
      </header>
      <main className="blog-background">
        <div className="content-layout">
          <BoardSidebar
            activeCategoryId={activeCategoryId}
            categories={categories}
            isHomeActive={isHomeActive}
            isLoggedIn={isLoggedIn}
            navigate={navigate}
            onCreateCategory={onCreateCategory}
          />
          <div className="route-panel">{children}</div>
        </div>
      </main>
    </div>
  );
}

function LoginPanel({ isLoggedIn, onLogin, onLogout }) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    const success = await onLogin(loginId.trim(), password);
    setIsSubmitting(false);

    if (success) {
      setLoginId("");
      setPassword("");
      return;
    }

    setError("아이디 또는 비밀번호가 맞지 않습니다.");
  }

  if (isLoggedIn) {
    return (
      <aside className="login-panel" aria-label="로그인 정보">
        <strong>관리자 로그인</strong>
        <p>게시판 생성이 가능합니다.</p>
        <button className="publish-button" type="button" onClick={onLogout}>로그아웃</button>
      </aside>
    );
  }

  return (
    <aside className="login-panel" aria-label="로그인">
      <strong>관리자 로그인</strong>
      <form className="login-form" onSubmit={submitLogin}>
        <input value={loginId} onChange={(event) => setLoginId(event.target.value)} placeholder="아이디" aria-label="아이디" />
        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="비밀번호" aria-label="비밀번호" type="password" />
        {error && <p className="login-error">{error}</p>}
        <button className="publish-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "확인 중" : "로그인"}</button>
      </form>
    </aside>
  );
}

function RecommendedSongCard({ song }) {
  return (
    <article className="main-card recommended-song-card">
      <h3>추천노래</h3>
      {song ? (
        <>
          <div className="youtube-frame">
            <iframe
              src={song.embedUrl}
              title={`${song.title || "오늘의 추천노래"} 유튜브 영상`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
          {song.title && <a className="song-link" href={song.url} target="_blank" rel="noreferrer">{song.title}</a>}
        </>
      ) : (
        <>
          <p>추천 준비 중</p>
          <small>오늘의 노래가 아직 없습니다.</small>
        </>
      )}
    </article>
  );
}

function MainPage({ posts, categories, navigate, isLoggedIn, onLogin, onLogout, visitCount, recommendationDateKey }) {
  const latestPosts = posts.slice(0, 3);
  const recommendedSong = useMemo(() => getDailyRecommendedSong(recommendationDateKey), [recommendationDateKey]);
  const operatorIntroduction = "태어냔 년도 : 2002년 \n 취미 : 요리 \n 힘들어도 열심히 \n 이 웹사이트는 ai도움을 받아 제 스스로 관리하는 웹 사이트입니다";

  return (
    <section className="main-panel" aria-labelledby="main-title">
      <div className="main-header">
        <h2 id="main-title">메인</h2>
      </div>
      <div className="main-content">
        <div className="main-card-grid">
          <article className="main-card operator-card">
            <img
              className="operator-profile"
              src="/images/profilel.png"
              alt="운영자 프로필"
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
            <div>
              <h3>운영자 소개</h3>
              <p>{operatorIntroduction}</p>
            </div>
          </article>
          <article className="main-card">
            <h3>새로운 게시판</h3>
            <div className="main-card-list">
              {latestPosts.length > 0 ? latestPosts.map((post) => (
                <button key={post.id} type="button" onClick={() => navigate(`/${post.id}`)}>
                  {categories.find((category) => category.id === post.categoryId)?.label || "게시판"} : {post.title}
                </button>
              )) : <span>새 게시글이 없습니다.</span>}
            </div>
          </article>
          <RecommendedSongCard song={recommendedSong} />
          <article className="main-card">
            <h3>게임 업데이트</h3>
            <p>새 게시판과 댓글 기능 준비 중</p>
            <small>업데이트 소식은 이 칸에 표시됩니다.</small>
          </article>
          <article className="main-card">
            <h3>방문자 수</h3>
            <p className="visit-count">{visitCount.toLocaleString("ko-KR")}</p>
          </article>
        </div>
        <LoginPanel isLoggedIn={isLoggedIn} onLogin={onLogin} onLogout={onLogout} />
      </div>
    </section>
  );
}

function BoardListPage({ category, posts, navigate, onDeletePost, isLoggedIn }) {
  const isWebtoon = category.groupType === "webtoon";

  function openEditor() {
    if (!isLoggedIn) {
      window.alert(`로그인 후 ${isWebtoon ? "웹툰" : "게시판"} 생성을 할 수 있습니다.`);
      return;
    }

    navigate(`/boards/${category.id}/new`);
  }

  return (
    <section className="board-panel" aria-labelledby="board-page-title">
      <div className="board-panel-header">
        <div>
          <p className="eyebrow">{isWebtoon ? "웹툰 목록" : "게시판 세부 목록"}</p>
          <h2 id="board-page-title">{category.label}</h2>
        </div>
        <button className={isLoggedIn ? "primary-button" : "primary-button is-locked"} type="button" onClick={openEditor}>
          {isWebtoon ? "웹툰 만들기" : "게시판 생성"}
        </button>
      </div>

      <div className="post-list" aria-label={`${category.label} 글 목록`}>
        {posts.map((post) => (
          <article key={post.id} className={isLoggedIn ? "post-card" : "post-card without-actions"}>
            <button className="post-open-button" type="button" onClick={() => navigate(`/${post.id}`)}>
              <strong>{post.title}</strong>
              <span>{post.excerpt}</span>
              <small>{post.author} · {post.createdAt}</small>
            </button>
            {isLoggedIn && (
              <button className="delete-button" type="button" onClick={() => onDeletePost(post)}>
                삭제
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function PostDetailPage({ post, navigate, onDeletePost, onAddComment, isLoggedIn }) {
  const postBlocks = getPostBlocks(post);
  const comments = Array.isArray(post.comments) ? post.comments : [];
  const [nickname, setNickname] = useState("");
  const [comment, setComment] = useState("");

  function submitComment(event) {
    event.preventDefault();
    const nextNickname = nickname.trim() || "익명";
    const nextComment = comment.trim();
    if (!nextComment) return;

    onAddComment(post.id, nextNickname, nextComment);
    setComment("");
  }

  return (
    <article className="board-panel post-detail">
      <div className="post-detail-actions">
        <button className="text-button" type="button" onClick={() => navigate(`/boards/${post.categoryId}`)}>← 목록으로</button>
        {isLoggedIn && (
          <div>
            <button className="text-button" type="button" onClick={() => navigate(`/${post.id}/edit`)}>수정</button>
            <button className="delete-button" type="button" onClick={() => onDeletePost(post)}>삭제</button>
          </div>
        )}
      </div>
      <h2>{post.title}</h2>
      <p className="post-meta">{post.author} · {post.createdAt}</p>
      {postBlocks.map((block, index) => (
        block.type === "image" ? (
          <img className="post-image-block" src={block.src} alt="첨부 이미지" key={`${block.id || block.type}-${index}`} />
        ) : block.type === "drawing" ? (
          <div className="post-drawing-frame" style={{ height: `${block.height || DEFAULT_DRAWING_HEIGHT}px` }} key={`${block.id || block.type}-${index}`}>
            <img className="post-drawing-image" src={block.src} alt="그림판으로 작성한 그림" />
          </div>
        ) : (
          <p className="post-content-block" key={`${block.id || block.type}-${index}`}>{block.content}</p>
        )
      ))}
      <section className="comment-section" aria-label="댓글">
        <h3>댓글</h3>
        <form className="comment-form" onSubmit={submitComment}>
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="닉네임" aria-label="댓글 닉네임" />
          <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="댓글을 입력하세요" aria-label="댓글 입력" />
          <button className="publish-button" type="submit">댓글 등록</button>
        </form>
        <div className="comment-list">
          {comments.length > 0 ? comments.map((item) => (
            <article className="comment-item" key={item.id}>
              <p>{item.content}</p>
              <small>{item.nickname || "익명"} · {item.createdAt}</small>
            </article>
          )) : <p className="empty-comments">아직 댓글이 없습니다.</p>}
        </div>
      </section>
    </article>
  );
}

function EditorTextBlock({ block, fontFamily, fontSize, onChange, onFocus }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [block.content, fontFamily, fontSize]);

  return (
    <textarea
      ref={textareaRef}
      className="body-input editor-text-block"
      style={{ fontFamily, fontSize: `${fontSize}px` }}
      value={block.content}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
      placeholder="글을 입력하세요"
    />
  );
}

function EditorPage({ category, initialPost = null, onCreate, onUpdate, navigate }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const historyRef = useRef([]);
  const textInputRef = useRef(null);
  const dragStateRef = useRef({ blockId: null, moved: false, startX: 0, startY: 0 });
  const suppressMediaClickRef = useRef(false);
  const [title, setTitle] = useState(() => initialPost?.title || "");
  const [blocks, setBlocks] = useState(() => {
    if (!initialPost) return [createTextBlock()];
    const initialBlocks = getPostBlocks(initialPost);
    return initialBlocks.length > 0 ? initialBlocks : [createTextBlock()];
  });
  const [fontFamily, setFontFamily] = useState(fonts[0].value);
  const [fontSize, setFontSize] = useState(18);
  const [activeDrawingId, setActiveDrawingId] = useState(null);
  const [focusedTextBlockId, setFocusedTextBlockId] = useState(null);
  const [draggedBlockId, setDraggedBlockId] = useState(null);
  const [dragOverBlockId, setDragOverBlockId] = useState(null);
  const [selectedMediaBlockId, setSelectedMediaBlockId] = useState(null);
  const [tool, setTool] = useState("brush");
  const [brushSize, setBrushSize] = useState(8);
  const [pendingText, setPendingText] = useState(null);
  const [canUndo, setCanUndo] = useState(false);
  const activeDrawingBlock = blocks.find((block) => block.id === activeDrawingId && block.type === "drawing");
  const hasBoardDrawing = blocks.some((block) => block.type === "drawing" || block.type === "image");
  const isDrawingActive = Boolean(activeDrawingBlock);

  useEffect(() => {
    function deleteSelectedMedia(event) {
      if (!selectedMediaBlockId || (event.key !== "Delete" && event.key !== "Backspace")) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

      event.preventDefault();
      setBlocks((currentBlocks) => {
        const nextBlocks = currentBlocks.filter((block) => block.id !== selectedMediaBlockId);
        return nextBlocks.length > 0 ? nextBlocks : [createTextBlock()];
      });
      if (activeDrawingId === selectedMediaBlockId) setActiveDrawingId(null);
      setSelectedMediaBlockId(null);
    }

    window.addEventListener("keydown", deleteSelectedMedia);
    return () => window.removeEventListener("keydown", deleteSelectedMedia);
  }, [activeDrawingId, selectedMediaBlockId]);

  const prepareContext = useCallback((context, selectedTool) => {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = selectedTool === "eraser" ? "#ffffff" : "#111111";
    context.fillStyle = "#111111";
    context.lineWidth = brushSize;
  }, [brushSize]);

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    historyRef.current.push(context.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > 20) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const canvas = canvasRef.current;
    const previousImage = historyRef.current.pop();
    if (!canvas || !previousImage) return;

    canvas.getContext("2d").putImageData(previousImage, 0, 0);
    setCanUndo(historyRef.current.length > 0);
    setPendingText(null);
    canvas.focus();
  }, []);

  useEffect(() => {
    if (!activeDrawingBlock || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    historyRef.current = [];
    setCanUndo(false);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (activeDrawingBlock.src) {
      const savedImage = new Image();
      savedImage.onload = () => context.drawImage(savedImage, 0, 0, canvas.width, canvas.height);
      savedImage.src = activeDrawingBlock.src;
    }

    canvas.focus();
  }, [activeDrawingId]);

  useEffect(() => {
    textInputRef.current?.focus();
  }, [pendingText]);

  useEffect(() => {
    if (!isDrawingActive) return undefined;

    function handleKeyDown(event) {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (isTyping) return;

      const shortcut = event.key.toLowerCase();
      if (shortcut === "b") {
        setPendingText(null);
        setTool("brush");
      }
      if (shortcut === "e") {
        setPendingText(null);
        setTool("eraser");
      }
      if (shortcut === "t") setTool("text");
      if (event.key === "1") {
        event.preventDefault();
        resizeActiveDrawing(DRAWING_HEIGHT_STEP);
      }
      if (event.key === "2") {
        event.preventDefault();
        resizeActiveDrawing(-DRAWING_HEIGHT_STEP);
      }

      if ((tool === "brush" || tool === "eraser") && event.code === "BracketLeft") {
        event.preventDefault();
        setBrushSize((currentSize) => Math.max(2, currentSize - 2));
      }

      if ((tool === "brush" || tool === "eraser") && event.code === "BracketRight") {
        event.preventDefault();
        setBrushSize((currentSize) => Math.min(60, currentSize + 2));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawingActive, tool, undo, activeDrawingId]);

  function updateTextBlock(blockId, content) {
    setBlocks((currentBlocks) => currentBlocks.map((block) => (
      block.id === blockId ? { ...block, content } : block
    )));
  }

  function resizeActiveDrawing(delta) {
    if (!activeDrawingId) return;

    setBlocks((currentBlocks) => currentBlocks.map((block) => {
      if (block.id !== activeDrawingId) return block;

      const nextHeight = Math.min(MAX_DRAWING_HEIGHT, Math.max(MIN_DRAWING_HEIGHT, (block.height || DEFAULT_DRAWING_HEIGHT) + delta));
      return { ...block, height: nextHeight };
    }));
    canvasRef.current?.focus();
  }

  function insertMediaBlockAfterText(mediaBlock) {
    const nextTextBlock = createTextBlock();

    setBlocks((currentBlocks) => {
      const focusedTextIndex = currentBlocks.findIndex((block) => block.id === focusedTextBlockId && block.type === "text");
      let targetTextIndex = focusedTextIndex;
      if (targetTextIndex < 0) {
        for (let index = currentBlocks.length - 1; index >= 0; index -= 1) {
          if (currentBlocks[index].type === "text") {
            targetTextIndex = index;
            break;
          }
        }
      }

      if (targetTextIndex < 0) return [...currentBlocks, mediaBlock, nextTextBlock];

      const targetTextBlock = currentBlocks[targetTextIndex];
      if (targetTextBlock.content.trim()) {
        return [
          ...currentBlocks.slice(0, targetTextIndex + 1),
          mediaBlock,
          nextTextBlock,
          ...currentBlocks.slice(targetTextIndex + 1),
        ];
      }

      return [
        ...currentBlocks.slice(0, targetTextIndex),
        mediaBlock,
        targetTextBlock,
        ...currentBlocks.slice(targetTextIndex + 1),
      ];
    });
    setFocusedTextBlockId(null);
  }

  function finishActiveDrawing() {
    if (!activeDrawingId || !canvasRef.current) return;

    const savedImage = canvasRef.current.toDataURL("image/png");
    const activeIndex = blocks.findIndex((block) => block.id === activeDrawingId);
    const nextTextBlock = blocks.slice(activeIndex + 1).find((block) => block.type === "text");

    setBlocks((currentBlocks) => currentBlocks.map((block) => (
      block.id === activeDrawingId ? { ...block, src: savedImage } : block
    )));
    setActiveDrawingId(null);
    setFocusedTextBlockId(nextTextBlock?.id || null);
    setPendingText(null);
    drawingRef.current = false;
    historyRef.current = [];
    setCanUndo(false);
  }

  function createDrawingAfterText() {
    const drawingBlock = createDrawingBlock();
    insertMediaBlockAfterText(drawingBlock);
    setActiveDrawingId(drawingBlock.id);
    setPendingText(null);
  }

  function handleDrawingButton() {
    if (isDrawingActive) {
      finishActiveDrawing();
      return;
    }

    createDrawingAfterText();
  }

  function editDrawingBlock(blockId) {
    if (suppressMediaClickRef.current) return;
    if (isDrawingActive) return;
    setPendingText(null);
    setActiveDrawingId(blockId);
  }

  function moveMediaBlock(dragBlockId, targetBlockId) {
    if (!dragBlockId || !targetBlockId || dragBlockId === targetBlockId) return;

    setBlocks((currentBlocks) => {
      const fromIndex = currentBlocks.findIndex((block) => block.id === dragBlockId);
      const targetIndex = currentBlocks.findIndex((block) => block.id === targetBlockId);
      if (fromIndex < 0 || targetIndex < 0) return currentBlocks;

      const movingBlock = currentBlocks[fromIndex];
      if (movingBlock.type !== "image" && movingBlock.type !== "drawing") return currentBlocks;

      const withoutMovingBlock = currentBlocks.filter((block) => block.id !== dragBlockId);
      const adjustedTargetIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
      return [
        ...withoutMovingBlock.slice(0, adjustedTargetIndex),
        movingBlock,
        ...withoutMovingBlock.slice(adjustedTargetIndex),
      ];
    });
  }

  function startMediaPointerDrag(event, blockId) {
    if (dragStateRef.current.blockId) return;

    dragStateRef.current = {
      blockId,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDraggedBlockId(blockId);
    setDragOverBlockId(blockId);
    if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveMediaByPoint(clientX, clientY) {
    const dragState = dragStateRef.current;
    if (!dragState.blockId) return false;

    const distanceX = Math.abs(clientX - dragState.startX);
    const distanceY = Math.abs(clientY - dragState.startY);
    if (!dragState.moved && distanceX + distanceY < 8) return false;

    dragState.moved = true;
    const targetBlock = document.elementFromPoint(clientX, clientY)?.closest("[data-editor-block-id]");
    const targetBlockId = targetBlock?.getAttribute("data-editor-block-id");
    if (targetBlockId && targetBlockId !== dragState.blockId) {
      moveMediaBlock(dragState.blockId, targetBlockId);
      setDragOverBlockId(targetBlockId);
    }
    return true;
  }

  function moveMediaPointer(event) {
    if (moveMediaByPoint(event.clientX, event.clientY)) event.preventDefault();
  }

  function moveMediaMouse(event) {
    if (moveMediaByPoint(event.clientX, event.clientY)) event.preventDefault();
  }

  function startMediaMouseDrag(event, blockId) {
    startMediaPointerDrag(event, blockId);
    window.addEventListener("mousemove", moveMediaMouse);
    window.addEventListener("mouseup", stopMediaDragState);
  }

  function stopMediaDragState() {
    const dragState = dragStateRef.current;
    if (!dragState.blockId) return;

    suppressMediaClickRef.current = dragState.moved;
    dragStateRef.current = { blockId: null, moved: false, startX: 0, startY: 0 };
    setDraggedBlockId(null);
    setDragOverBlockId(null);
    window.removeEventListener("mousemove", moveMediaMouse);
    window.removeEventListener("mouseup", stopMediaDragState);
    window.setTimeout(() => {
      suppressMediaClickRef.current = false;
    }, 0);
  }

  function stopMediaPointerDrag(event) {
    if (event.pointerId !== undefined) event.currentTarget.releasePointerCapture?.(event.pointerId);
    stopMediaDragState();
  }

  function getPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event) {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = getPoint(event);
    canvas.focus();

    if (tool === "text") {
      const frameRect = canvas.parentElement.getBoundingClientRect();
      setPendingText({
        canvasX: point.x,
        canvasY: point.y,
        displayX: event.clientX - frameRect.left,
        displayY: event.clientY - frameRect.top,
        value: "",
      });
      return;
    }

    saveHistory();
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    prepareContext(context, tool);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(point.x + 0.1, point.y + 0.1);
    context.stroke();
  }

  function draw(event) {
    if (!drawingRef.current || tool === "text") return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const point = getPoint(event);

    prepareContext(context, tool);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing(event) {
    if (!drawingRef.current) return;

    drawingRef.current = false;
    const canvas = canvasRef.current;
    canvas.getContext("2d").closePath();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    saveHistory();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setPendingText(null);
    canvas.focus();
  }

  function selectTool(nextTool) {
    setPendingText(null);
    setTool(nextTool);
  }

  function commitText() {
    const value = pendingText?.value.trim();
    if (!value) {
      setPendingText(null);
      canvasRef.current?.focus();
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    saveHistory();
    prepareContext(context, "text");
    context.font = `${Math.max(18, fontSize * 2)}px Arial, sans-serif`;
    context.textBaseline = "top";
    context.fillText(value, pendingText.canvasX, pendingText.canvasY);
    setPendingText(null);
    canvas.focus();
  }

  function handleTextKeyDown(event) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commitText();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setPendingText(null);
      canvasRef.current?.focus();
    }
  }

  function exportPng() {
    canvasRef.current.toBlob((blob) => {
      if (!blob) return;

      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.download = `board-drawing-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  function insertImageFile(file, onComplete) {
    const reader = new FileReader();
    reader.onload = () => {
      insertMediaBlockAfterText(createImageBlock(reader.result));
      onComplete?.();
    };
    reader.readAsDataURL(file);
  }

  function handleImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    insertImageFile(file, () => {
      event.target.value = "";
    });
  }

  function handleImagePaste(event) {
    const imageItem = Array.from(event.clipboardData?.items || [])
      .find((item) => item.type.startsWith("image/"));
    const imageFile = imageItem?.getAsFile();
    if (!imageFile) return;

    event.preventDefault();
    insertImageFile(imageFile);
  }

  function submitPost() {
    const publishedTitle = title.trim() || "제목 없음";
    const id = initialPost?.id || Date.now();
    const publishedBlocks = blocks
      .map((block) => (
        block.id === activeDrawingId && canvasRef.current
          ? { ...block, src: canvasRef.current.toDataURL("image/png") }
          : block
      ))
      .filter((block) => (block.type === "text" ? block.content.trim() : block.src));
    const content = getTextContent(publishedBlocks);
    const image = publishedBlocks.find((block) => block.type === "image")?.src || "";
    const drawing = publishedBlocks.find((block) => block.type === "drawing")?.src || "";

    const nextPost = {
      ...initialPost,
      id,
      categoryId: category.id,
      title: publishedTitle,
      author: initialPost?.author || "작성자",
      createdAt: initialPost?.createdAt || new Date().toLocaleDateString("ko-KR"),
      excerpt: content.slice(0, 56) || (drawing ? "그림판이 포함된 글입니다." : "새 글입니다."),
      content,
      image,
      drawing,
      blocks: publishedBlocks,
    };
    if (initialPost) {
      onUpdate(nextPost);
    } else {
      onCreate(nextPost);
    }
    navigate(`/${id}`);
  }

  return (
    <section className={`editor-page ${isDrawingActive ? "is-paint-mode" : ""} ${hasBoardDrawing ? "has-board-drawing" : ""}`} aria-labelledby="editor-title">
      <div className="editor-topbar">
        <strong>{category.groupType === "webtoon" ? "웹툰" : "게시판"}</strong>
        <div>
          <button className="text-button" type="button" onClick={() => navigate(`/boards/${category.id}`)}>취소</button>
          <button className="publish-button" type="button" onClick={submitPost}>{initialPost ? "수정 완료" : "발행"}</button>
        </div>
      </div>
      <div className="editor-toolbar" aria-label="작성 도구">
        <label>사진<input type="file" accept="image/*" onChange={handleImage} /></label>
        <label>글꼴<select value={fontFamily} onChange={(event) => setFontFamily(event.target.value)}>{fonts.map((font) => <option key={font.label} value={font.value}>{font.label}</option>)}</select></label>
        <label>글자크기<input type="number" min="12" max="48" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} /></label>
        <button className={isDrawingActive ? "tool-toggle is-on" : "tool-toggle"} type="button" onClick={handleDrawingButton}>{isDrawingActive ? "그림판 저장" : "그림판 생성"}</button>
      </div>

      {isDrawingActive && (
        <div className="paint-toolbar" aria-label="그림판 도구">
          <div className="tool-buttons">
            {drawingTools.map((item) => (
              <button key={item.id} className={`tool-button ${tool === item.id ? "is-active" : ""}`} type="button" aria-pressed={tool === item.id} onClick={() => selectTool(item.id)}>
                <kbd>{item.shortcut}</kbd>
                {item.label}
              </button>
            ))}
          </div>
          {(tool === "brush" || tool === "eraser") && <span className="brush-size">크기 {brushSize}px <small>[ 작게 · ] 크게</small></span>}
          <span className="canvas-size">그림판 {activeDrawingBlock.height}px <small>1 크게 · 2 작게</small></span>
          <div className="toolbar-actions">
            <button className="undo-button" type="button" disabled={!canUndo} onClick={undo}>실행 취소<small>Ctrl+Z</small></button>
            <button className="clear-canvas-button" type="button" onClick={clearCanvas}>전체 지우기</button>
            <button className="export-button" type="button" onClick={exportPng}>PNG 내보내기</button>
          </div>
        </div>
      )}

      <div className="paper" onPaste={handleImagePaste}>
        <input id="editor-title" className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="제목" />
        <div className="editor-blocks">
          {blocks.map((block) => (
            <div className={`editor-block editor-block-${block.type} ${dragOverBlockId === block.id ? "is-drag-over" : ""}`} data-editor-block-id={block.id} key={block.id}>
              {block.type === "image" ? (
                <div
                  className={`editor-image-frame ${selectedMediaBlockId === block.id ? "is-selected" : ""}`}
                  tabIndex="0"
                  onClick={() => setSelectedMediaBlockId(block.id)}
                  onPointerDown={(event) => startMediaPointerDrag(event, block.id)}
                  onPointerMove={moveMediaPointer}
                  onPointerUp={stopMediaPointerDrag}
                  onPointerCancel={stopMediaPointerDrag}
                  onMouseDown={(event) => startMediaMouseDrag(event, block.id)}
                >
                  <img className="editor-image-block" src={block.src} alt="첨부 이미지" draggable={false} />
                </div>
              ) : block.type === "drawing" ? (
                <div className="editor-drawing-block">
                  {block.id === activeDrawingId ? (
                    <div className="board-canvas-frame" style={{ height: `${block.height || DEFAULT_DRAWING_HEIGHT}px` }}>
                      <canvas ref={canvasRef} className={`drawing-canvas tool-${tool}`} width="1200" height="720" tabIndex="0" aria-label="게시판 그림판" onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} onPointerLeave={stopDrawing} />
                      {pendingText && (
                        <input ref={textInputRef} className="canvas-text-input" type="text" maxLength="40" aria-label="캔버스 텍스트 입력" placeholder="입력 후 Enter" value={pendingText.value} style={{ left: pendingText.displayX, top: pendingText.displayY }} onChange={(event) => setPendingText((currentText) => ({ ...currentText, value: event.target.value }))} onKeyDown={handleTextKeyDown} />
                      )}
                    </div>
                  ) : (
                    <button className="saved-drawing-frame" style={{ height: `${block.height || DEFAULT_DRAWING_HEIGHT}px` }} type="button" onPointerDown={(event) => startMediaPointerDrag(event, block.id)} onPointerMove={moveMediaPointer} onPointerUp={stopMediaPointerDrag} onPointerCancel={stopMediaPointerDrag} onMouseDown={(event) => startMediaMouseDrag(event, block.id)} onClick={() => editDrawingBlock(block.id)} aria-label="그림판 다시 편집">
                      <img className="saved-drawing-image" src={block.src} alt="그림판으로 작성한 그림" draggable={false} />
                    </button>
                  )}
                </div>
              ) : (
                <EditorTextBlock block={block} fontFamily={fontFamily} fontSize={fontSize} onFocus={() => setFocusedTextBlockId(block.id)} onChange={(value) => updateTextBlock(block.id, value)} />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LoginRequiredPage({ navigate }) {
  return (
    <section className="board-panel login-required">
      <p className="eyebrow">로그인 필요</p>
      <h2>게시판 생성은 로그인 후 가능합니다.</h2>
      <p>로그인하지 않은 상태에서는 게시글 댓글만 작성할 수 있습니다.</p>
      <button className="primary-button" type="button" onClick={() => navigate("/")}>메인으로</button>
    </section>
  );
}

export default function App() {
  const { path, navigate } = usePath();
  const [posts, setPosts] = useState(loadStoredPosts);
  const [isPostStorageReady, setIsPostStorageReady] = useState(false);
  const [categories, setCategories] = useState(loadStoredCategories);
  const [isLoggedIn, setIsLoggedIn] = useState(() => window.localStorage.getItem(AUTH_STORAGE_KEY) === "true");
  const [visitCount, setVisitCount] = useState(getInitialVisitCount);
  const [recommendationDateKey, setRecommendationDateKey] = useState(getTodayKey);

  useEffect(() => {
    let isMounted = true;

    loadPostsFromDatabase()
      .then((storedPosts) => {
        if (!isMounted) return;
        if (Array.isArray(storedPosts)) setPosts(storedPosts);
        setIsPostStorageReady(true);
      })
      .catch(() => {
        if (isMounted) setIsPostStorageReady(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isPostStorageReady) return;
    savePostsToDatabase(posts).catch(() => {
      window.alert("게시글을 저장하지 못했습니다. 사진 용량을 줄여 다시 시도해 주세요.");
    });
  }, [isPostStorageReady, posts]);

  useEffect(() => {
    window.localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
  }, [categories]);

  useEffect(() => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, isLoggedIn ? "true" : "false");
  }, [isLoggedIn]);

  useEffect(() => {
    let isMounted = true;

    recordVisit()
      .then((nextCount) => {
        if (!isMounted) return;
        window.localStorage.setItem(VISIT_STORAGE_KEY, String(nextCount));
        setVisitCount(nextCount);
      })
      .catch(() => {
        if (window.sessionStorage.getItem(VISIT_SESSION_KEY) === "true") return;

        setVisitCount((currentCount) => {
          const nextCount = currentCount + 1;
          window.localStorage.setItem(VISIT_STORAGE_KEY, String(nextCount));
          window.sessionStorage.setItem(VISIT_SESSION_KEY, "true");
          return nextCount;
        });
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let midnightTimerId;

    function scheduleMidnightRefresh() {
      midnightTimerId = window.setTimeout(() => {
        setRecommendationDateKey(getTodayKey());
        scheduleMidnightRefresh();
      }, getMillisecondsUntilNextMidnight());
    }

    scheduleMidnightRefresh();
    return () => window.clearTimeout(midnightTimerId);
  }, []);

  const categoryFromPath = path.match(/^\/boards\/([^/]+)/)?.[1];
  const detailId = path.match(/^\/(\d+)/)?.[1];
  const activeCategoryId = categoryFromPath || posts.find((post) => String(post.id) === detailId)?.categoryId || "daily";
  const activeCategory = categories.find((category) => category.id === activeCategoryId) || categories[0];

  const handleLogin = useCallback(async (loginId, password) => {
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const result = await response.json().catch(() => ({ success: false }));
      const success = Boolean(response.ok && result.success);
      setIsLoggedIn(success);
      return success;
    } catch {
      setIsLoggedIn(false);
      return false;
    }
  }, []);

  const handleLogout = useCallback(() => {
    setIsLoggedIn(false);
  }, []);

  const createCategory = useCallback((groupType) => {
    const label = window.prompt("새 세부 목록 이름을 입력하세요.");
    const trimmedLabel = label?.trim();
    if (!trimmedLabel) return;

    const category = {
      id: `${groupType}-${Date.now()}`,
      label: trimmedLabel,
      groupType,
    };
    setCategories((currentCategories) => [...currentCategories, category]);
    navigate(`/boards/${category.id}`);
  }, [navigate]);

  const deletePost = useCallback((post) => {
    const confirmed = window.confirm(`"${post.title}" 게시글을 삭제할까요?`);
    if (!confirmed) return;

    setPosts((currentPosts) => currentPosts.filter((currentPost) => currentPost.id !== post.id));
    navigate(`/boards/${post.categoryId}`);
  }, [navigate]);

  const addComment = useCallback((postId, nickname, content) => {
    setPosts((currentPosts) => currentPosts.map((post) => {
      if (post.id !== postId) return post;

      const nextComment = {
        id: Date.now(),
        nickname,
        content,
        createdAt: new Date().toLocaleString("ko-KR"),
      };
      return { ...post, comments: [...(Array.isArray(post.comments) ? post.comments : []), nextComment] };
    }));
  }, []);

  const updatePost = useCallback((updatedPost) => {
    setPosts((currentPosts) => currentPosts.map((post) => (
      post.id === updatedPost.id ? updatedPost : post
    )));
  }, []);

  const page = useMemo(() => {
    if (path === "/") return <MainPage posts={posts} categories={categories} navigate={navigate} isLoggedIn={isLoggedIn} onLogin={handleLogin} onLogout={handleLogout} visitCount={visitCount} recommendationDateKey={recommendationDateKey} />;
    if (path.endsWith("/new")) {
      if (!isLoggedIn) return <LoginRequiredPage navigate={navigate} />;
      return <EditorPage category={activeCategory} onCreate={(post) => setPosts((current) => [post, ...current])} navigate={navigate} />;
    }
    if (path.endsWith("/edit") && detailId) {
      if (!isLoggedIn) return <LoginRequiredPage navigate={navigate} />;
      const post = posts.find((item) => String(item.id) === detailId);
      return post
        ? <EditorPage category={activeCategory} initialPost={post} onUpdate={updatePost} navigate={navigate} />
        : <BoardListPage category={activeCategory} posts={posts.filter((postItem) => postItem.categoryId === activeCategory.id)} navigate={navigate} onDeletePost={deletePost} isLoggedIn={isLoggedIn} />;
    }
    if (detailId) {
      const post = posts.find((item) => String(item.id) === detailId);
      return post ? <PostDetailPage post={post} navigate={navigate} onDeletePost={deletePost} onAddComment={addComment} isLoggedIn={isLoggedIn} /> : <BoardListPage category={activeCategory} posts={posts.filter((postItem) => postItem.categoryId === activeCategory.id)} navigate={navigate} onDeletePost={deletePost} isLoggedIn={isLoggedIn} />;
    }
    return <BoardListPage category={activeCategory} posts={posts.filter((post) => post.categoryId === activeCategory.id)} navigate={navigate} onDeletePost={deletePost} isLoggedIn={isLoggedIn} />;
  }, [activeCategory, addComment, categories, deletePost, detailId, handleLogin, handleLogout, isLoggedIn, navigate, path, posts, recommendationDateKey, updatePost, visitCount]);

  return (
    <BlogLayout
      activeCategoryId={activeCategory.id}
      categories={categories}
      isHomeActive={path === "/"}
      isLoggedIn={isLoggedIn}
      navigate={navigate}
      onCreateCategory={createCategory}
    >
      {page}
    </BlogLayout>
  );
}
