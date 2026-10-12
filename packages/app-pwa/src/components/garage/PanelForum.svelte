<script lang="ts">
/**
 * PanelForum.svelte — Panel de Discusión y Comunidad del vehículo por versión.
 *
 * Permite listar los hilos de la versión, ver publicaciones y respuestas,
 * abrir nuevos hilos de debate y responder de forma interactiva.
 * Todo el contenido se renderiza como texto plano seguro (sin {@html}).
 */
import type { ForumPost, ForumThread } from '../../garage/contracts';
import { garageApi } from './api';
import { formatTimeAgo } from './formatters';

interface Props {
  versionKey: string;
}

const { versionKey }: Props = $props();

let threads = $state<ForumThread[]>([]);
let activeThread = $state<ForumThread | null>(null);
let activePosts = $state<ForumPost[]>([]);
let isLoading = $state(true);

// Estado para crear nuevo hilo
let isCreatingThread = $state(false);
let newTitle = $state('');
let newBody = $state('');
let newTags = $state('');
let isSubmittingThread = $state(false);

// Estado para responder
let replyBody = $state('');
let isSubmittingReply = $state(false);

$effect(() => {
  if (versionKey) {
    loadThreads();
  }
});

async function loadThreads() {
  isLoading = true;
  activeThread = null;
  isCreatingThread = false;
  try {
    threads = await garageApi.getForumThreads(versionKey);
  } finally {
    isLoading = false;
  }
}

async function openThread(t: ForumThread) {
  isLoading = true;
  try {
    const res = await garageApi.getForumThreadDetail(t.id);
    activeThread = res.thread;
    activePosts = res.posts;
  } finally {
    isLoading = false;
  }
}

async function handleCreateThread(e: SubmitEvent) {
  e.preventDefault();
  if (!newTitle.trim() || !newBody.trim()) return;
  isSubmittingThread = true;
  try {
    const tags = newTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const created = await garageApi.createForumThread(versionKey, newTitle, newBody, tags);
    threads.unshift(created);
    isCreatingThread = false;
    newTitle = '';
    newBody = '';
    newTags = '';
    await openThread(created);
  } finally {
    isSubmittingThread = false;
  }
}

async function handleSendReply(e: SubmitEvent) {
  e.preventDefault();
  if (!activeThread || !replyBody.trim()) return;
  isSubmittingReply = true;
  try {
    const post = await garageApi.createForumPost(activeThread.id, replyBody);
    activePosts.push(post);
    activeThread.replyCount += 1;
    replyBody = '';
  } finally {
    isSubmittingReply = false;
  }
}
</script>

<div class="panel-forum-root">
  {#if activeThread}
    <!-- Vista de detalle de hilo -->
    <div class="thread-detail-view">
      <button
        type="button"
        class="back-btn"
        onclick={() => (activeThread = null)}
      >
        ◀ Volver a todos los hilos
      </button>

      <article class="thread-main-card swal-card-frame is-active">
       <div class="thread-main-inner swal-card-inner">
        <h3 class="thread-title">{activeThread.title}</h3>
        <div class="post-meta">
          <span class="author">{activeThread.authorName}</span>
          <span class="dot">·</span>
          <span class="time">{formatTimeAgo(activeThread.createdAt)}</span>
        </div>
        <p class="post-body">{activeThread.body}</p>
        {#if activeThread.tags.length > 0}
          <div class="tags-row">
            {#each activeThread.tags as tag}
              <span class="tag-pill">#{tag}</span>
            {/each}
          </div>
        {/if}
       </div>
      </article>

      <!-- Lista de respuestas -->
      <section class="replies-section">
        <h4 class="replies-title">Respuestas ({activePosts.length})</h4>
        {#if activePosts.length === 0}
          <p class="empty-replies">Aún no hay respuestas. ¡Sé el primero en aportar!</p>
        {:else}
          <div class="replies-list" role="list">
            {#each activePosts as post (post.id)}
              <div class="reply-card swal-card-frame" role="listitem">
               <div class="reply-inner swal-card-inner">
                <div class="post-meta">
                  <span class="author">{post.authorName}</span>
                  <span class="dot">·</span>
                  <span class="time">{formatTimeAgo(post.createdAt)}</span>
                </div>
                <p class="post-body">{post.body}</p>
               </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Formulario de respuesta -->
        <form class="reply-form" onsubmit={handleSendReply}>
          <textarea
            class="reply-textarea"
            rows="3"
            bind:value={replyBody}
            placeholder="Escribe tu respuesta a la comunidad..."
            required
          ></textarea>
          <button
            type="submit"
            class="submit-reply-btn swal-chamfer-sm"
            disabled={isSubmittingReply || !replyBody.trim()}
          >
            {isSubmittingReply ? 'Publicando...' : 'Responder'}
          </button>
        </form>
      </section>
    </div>
  {:else if isCreatingThread}
    <!-- Formulario para crear nuevo hilo -->
    <div class="create-thread-view">
      <button
        type="button"
        class="back-btn"
        onclick={() => (isCreatingThread = false)}
      >
        ◀ Cancelar y volver
      </button>

      <form class="thread-form" onsubmit={handleCreateThread}>
        <h3 class="form-title">Crear nueva consulta o aporte</h3>

        <div class="field">
          <label for="t-title" class="label">Título de la consulta</label>
          <input
            id="t-title"
            type="text"
            class="input"
            bind:value={newTitle}
            placeholder="Ej. Rendimiento con gasolina corriente vs extra..."
            required
          />
        </div>

        <div class="field">
          <label for="t-body" class="label">Detalle del tema</label>
          <textarea
            id="t-body"
            class="textarea"
            rows="5"
            bind:value={newBody}
            placeholder="Explica tu caso con kilometraje, contexto y síntomas..."
            required
          ></textarea>
        </div>

        <div class="field">
          <label for="t-tags" class="label">Etiquetas (separadas por comas)</label>
          <input
            id="t-tags"
            type="text"
            class="input"
            bind:value={newTags}
            placeholder="frenos, aceite, transmision"
          />
        </div>

        <div class="form-actions">
          <button
            type="submit"
            class="submit-thread-btn swal-chamfer-sm"
            disabled={isSubmittingThread || !newTitle.trim() || !newBody.trim()}
          >
            {isSubmittingThread ? 'Publicando...' : 'Publicar consulta'}
          </button>
        </div>
      </form>
    </div>
  {:else}
    <!-- Lista principal de hilos -->
    <div class="threads-list-view">
      <div class="forum-top-bar">
        <span class="threads-count">{threads.length} conversaciones activas</span>
        <button
          type="button"
          class="create-btn swal-chamfer-sm"
          onclick={() => (isCreatingThread = true)}
        >
          + Nueva consulta
        </button>
      </div>

      {#if isLoading}
        <div class="loading-state">
          <span class="spinner"></span>
          <span>Cargando hilos del foro...</span>
        </div>
      {:else if threads.length === 0}
        <div class="empty-state">
          <span class="empty-icon">💬</span>
          <p class="empty-title">Aún no hay hilos para esta versión</p>
          <p class="empty-desc">Inicia el primer debate o consulta con otros propietarios.</p>
        </div>
      {:else}
        <div class="threads-list" role="list">
          {#each threads as t (t.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="thread-card swal-card-frame {t.pinned ? 'is-active' : ''}"
              role="listitem"
              tabindex="0"
              onclick={() => openThread(t)}
            >
             <div class="thread-inner swal-card-inner">
              <div class="card-head">
                {#if t.pinned}
                  <span class="pin-badge">📌 Fijado</span>
                {/if}
                <h4 class="card-title">{t.title}</h4>
              </div>

              <p class="card-snippet">{t.body}</p>

              <div class="card-foot">
                <div class="foot-meta">
                  <span class="author">{t.authorName}</span>
                  <span class="dot">·</span>
                  <span class="time">{formatTimeAgo(t.lastActivityAt)}</span>
                </div>
                <span class="replies-counter">💬 {t.replyCount}</span>
              </div>
             </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel-forum-root {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .threads-list-view {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  .forum-top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .threads-count {
    font-family: var(--swal-font-mono);
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--swal-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }

  /* Botones primarios: relleno naranja, texto de contraste, esquina cortada. */
  .create-btn,
  .submit-reply-btn,
  .submit-thread-btn {
    background: var(--swal-accent);
    border: none;
    color: var(--swal-accent-contrast);
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.4rem 0.85rem;
    cursor: pointer;
    transition: background 120ms ease;
  }
  .create-btn:hover,
  .submit-reply-btn:hover:not(:disabled),
  .submit-thread-btn:hover:not(:disabled) {
    background: var(--swal-accent-hover);
  }
  .submit-reply-btn,
  .submit-thread-btn {
    align-self: flex-start;
    font-size: 0.78rem;
  }
  .submit-reply-btn:disabled,
  .submit-thread-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .create-btn:focus-visible,
  .submit-reply-btn:focus-visible,
  .submit-thread-btn:focus-visible,
  .back-btn:focus-visible,
  .thread-card:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }

  .threads-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .thread-card {
    cursor: pointer;
  }
  .thread-inner {
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    transition: background 120ms ease;
  }
  .thread-card:hover .thread-inner {
    background: var(--swal-surface-hover);
  }

  .card-head {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .pin-badge {
    font-family: var(--swal-font-mono);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--swal-warning);
    font-weight: 700;
  }
  .card-title {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--swal-text);
    margin: 0;
  }
  .card-snippet {
    font-size: 0.76rem;
    color: var(--swal-text-secondary);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }
  .card-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--swal-border);
    padding-top: 0.4rem;
  }
  .foot-meta {
    font-family: var(--swal-font-mono);
    font-size: 0.64rem;
    letter-spacing: 0.04em;
    color: var(--swal-text-muted);
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .replies-counter {
    font-family: var(--swal-font-mono);
    font-size: 0.7rem;
    color: var(--swal-accent-text);
    font-weight: 700;
  }

  /* Vista detalle e hilo */
  .back-btn {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--swal-accent-text);
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0.2rem 0;
    margin-bottom: 0.5rem;
  }
  .thread-main-inner {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .thread-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--swal-text);
    margin: 0;
  }
  .post-meta {
    font-family: var(--swal-font-mono);
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    color: var(--swal-text-muted);
    display: flex;
    gap: 0.3rem;
  }
  .post-body {
    font-size: 0.8rem;
    color: var(--swal-text-secondary);
    line-height: 1.5;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tags-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .tag-pill {
    font-family: var(--swal-font-mono);
    font-size: 0.64rem;
    background: var(--swal-accent-muted);
    color: var(--swal-accent-text);
    padding: 0.15rem 0.5rem;
  }

  .replies-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  .replies-title {
    font-family: var(--swal-font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--swal-text-muted);
    margin: 0;
  }
  .replies-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .empty-replies {
    font-size: 0.78rem;
    color: var(--swal-text-muted);
    font-style: italic;
  }
  .reply-inner {
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .reply-form,
  .thread-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.5rem;
  }
  .reply-textarea,
  .textarea,
  .input {
    width: 100%;
    background: var(--swal-bg-elevated);
    border: 1px solid var(--swal-border-strong);
    border-radius: var(--swal-radius-sm);
    color: var(--swal-text);
    padding: 0.6rem;
    font-family: inherit;
    font-size: 0.8rem;
    box-sizing: border-box;
    outline: none;
  }
  .reply-textarea::placeholder,
  .textarea::placeholder,
  .input::placeholder {
    color: var(--swal-text-muted);
  }
  .reply-textarea:focus,
  .textarea:focus,
  .input:focus {
    border-color: var(--swal-accent);
    outline: 2px solid var(--swal-accent);
    outline-offset: 1px;
  }

  .form-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--swal-text);
    margin: 0 0 0.5rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .label {
    font-family: var(--swal-font-mono);
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--swal-text-muted);
  }

  .loading-state,
  .empty-state {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--swal-text-muted);
  }
  .empty-icon {
    font-size: 2rem;
    display: block;
    margin-bottom: 0.5rem;
  }
  .empty-title {
    font-weight: 700;
    color: var(--swal-text-secondary);
    margin: 0;
  }
  .empty-desc {
    font-size: 0.78rem;
    margin: 0.25rem 0 0;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--swal-border);
    border-top-color: var(--swal-accent);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
    display: inline-block;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
