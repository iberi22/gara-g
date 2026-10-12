<script lang="ts">
/**
 * PanelWiki.svelte — Panel de Documentación técnica y colaborativa (Wiki).
 *
 * Muestra especificaciones de fábrica e intervalos de mantenimiento (solo lectura)
 * y permite editar secciones de consejos comunitarios con control optimista.
 * Todo el contenido se renderiza como texto plano seguro (sin {@html}).
 */
import type { WikiPage, WikiSection } from '../../garage/contracts';
import { garageApi } from './api';

interface Props {
  versionKey: string;
}

const { versionKey }: Props = $props();

let wikiPage = $state<WikiPage | null>(null);
let isLoading = $state(true);
let editingSectionId = $state<string | null>(null);
let editBodyText = $state<string>('');
let isSaving = $state(false);

$effect(() => {
  if (versionKey) {
    isLoading = true;
    void garageApi.getWiki(versionKey).then((page) => {
      wikiPage = page;
      isLoading = false;
    });
  }
});

function startEditing(sec: WikiSection) {
  editingSectionId = sec.id;
  editBodyText = sec.body;
}

function cancelEditing() {
  editingSectionId = null;
  editBodyText = '';
}

async function saveEditing(sec: WikiSection) {
  if (!wikiPage) return;
  isSaving = true;
  try {
    const updated = await garageApi.updateWikiSection(
      wikiPage.versionKey,
      sec.id,
      editBodyText,
      wikiPage.revision,
    );
    wikiPage = updated;
    editingSectionId = null;
  } finally {
    isSaving = false;
  }
}
</script>

<div class="panel-wiki-root">
  {#if isLoading}
    <div class="loading-state">
      <span class="spinner"></span>
      <span>Cargando manual técnico y aportes...</span>
    </div>
  {:else if wikiPage}
    <div class="wiki-header-meta swal-card-frame">
      <div class="wiki-header-inner swal-card-inner">
        <span class="version-label"><span class="swal-tick" aria-hidden="true"></span> {wikiPage.version.label}</span>
        <span class="rev-badge">REV. #{wikiPage.revision}</span>
      </div>
    </div>

    <div class="sections-list">
      {#each wikiPage.sections as sec (sec.id)}
        <article class="wiki-card swal-card-frame {sec.source === 'catalog' ? 'is-active' : ''}">
         <div class="wiki-inner swal-card-inner">
          <header class="section-header">
            <div class="header-left">
              <span class="source-pill {sec.source}">
                {sec.source === 'catalog' ? 'OFICIAL' : 'COMUNIDAD'}
              </span>
              <h3 class="section-title">{sec.title}</h3>
            </div>
            {#if sec.editable && editingSectionId !== sec.id}
              <button
                type="button"
                class="edit-btn"
                onclick={() => startEditing(sec)}
              >
                ✏️ Editar
              </button>
            {/if}
          </header>

          {#if editingSectionId === sec.id}
            <!-- Formulario de edición -->
            <div class="edit-form">
              <textarea
                class="edit-textarea"
                rows="6"
                bind:value={editBodyText}
                placeholder="Escribe aquí los consejos o especificaciones..."
              ></textarea>
              <div class="edit-actions">
                <button
                  type="button"
                  class="save-btn swal-chamfer-sm"
                  disabled={isSaving}
                  onclick={() => saveEditing(sec)}
                >
                  {isSaving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button
                  type="button"
                  class="cancel-btn"
                  disabled={isSaving}
                  onclick={cancelEditing}
                >
                  Cancelar
                </button>
              </div>
            </div>
          {:else}
            <!-- Texto plano seguro -->
            <p class="section-body">{sec.body}</p>
          {/if}

          {#if sec.updatedBy}
            <footer class="section-footer">
              <span>Aporte de: {sec.updatedBy}</span>
            </footer>
          {/if}
         </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .panel-wiki-root {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .wiki-header-inner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
  }
  .version-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--swal-font-mono);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--swal-text);
  }
  .rev-badge {
    font-family: var(--swal-font-mono);
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--swal-accent-text);
    background: var(--swal-accent-muted);
    padding: 0.15rem 0.5rem;
  }

  .sections-list {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  /* Oficial (catálogo) = marco naranja; comunidad = hairline normal. */
  .wiki-inner {
    padding: 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }
  .header-left {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .source-pill {
    align-self: flex-start;
    font-family: var(--swal-font-mono);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    padding: 0.1rem 0.4rem;
  }
  .source-pill.catalog {
    background: var(--swal-accent-muted);
    color: var(--swal-accent-text);
  }
  .source-pill.community {
    background: var(--swal-info-muted);
    color: var(--swal-text-secondary);
  }

  .section-title {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--swal-text);
    margin: 0;
  }

  .edit-btn {
    background: var(--swal-surface);
    border: 1px solid var(--swal-border-strong);
    color: var(--swal-text-secondary);
    font-size: 0.7rem;
    padding: 0.25rem 0.55rem;
    border-radius: var(--swal-radius-sm);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }
  .edit-btn:hover {
    background: var(--swal-surface-hover);
    border-color: var(--swal-accent);
    color: var(--swal-text);
  }
  .edit-btn:focus-visible,
  .save-btn:focus-visible,
  .cancel-btn:focus-visible {
    outline: 2px solid var(--swal-accent);
    outline-offset: 2px;
  }

  .section-body {
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--swal-text-secondary);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .section-footer {
    font-family: var(--swal-font-mono);
    font-size: 0.64rem;
    letter-spacing: 0.04em;
    color: var(--swal-text-muted);
    border-top: 1px solid var(--swal-border);
    padding-top: 0.4rem;
  }

  /* Edición */
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .edit-textarea {
    width: 100%;
    background: var(--swal-bg-elevated);
    border: 1px solid var(--swal-border-strong);
    border-radius: var(--swal-radius-sm);
    color: var(--swal-text);
    padding: 0.6rem;
    font-family: inherit;
    font-size: 0.78rem;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }
  .edit-textarea:focus {
    border-color: var(--swal-accent);
    outline: 2px solid var(--swal-accent);
    outline-offset: 1px;
  }
  .edit-actions {
    display: flex;
    gap: 0.5rem;
  }
  .save-btn {
    background: var(--swal-accent);
    border: none;
    color: var(--swal-accent-contrast);
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.35rem 0.8rem;
    cursor: pointer;
  }
  .save-btn:hover:not(:disabled) {
    background: var(--swal-accent-hover);
  }
  .save-btn:disabled,
  .cancel-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .cancel-btn {
    background: transparent;
    border: 1px solid var(--swal-border-strong);
    color: var(--swal-text-secondary);
    font-size: 0.75rem;
    padding: 0.35rem 0.8rem;
    border-radius: var(--swal-radius-sm);
    cursor: pointer;
  }

  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 3rem 1rem;
    color: var(--swal-text-muted);
    font-size: 0.82rem;
  }
  .spinner {
    width: 18px;
    height: 18px;
    border: 2px solid var(--swal-border);
    border-top-color: var(--swal-accent);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
