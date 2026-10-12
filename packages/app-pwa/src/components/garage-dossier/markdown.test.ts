import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('escapa cualquier HTML del modelo', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> **ok** <script>x</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>ok</strong>');
  });

  it('no genera enlaces ni atributos desde el texto', () => {
    const html = renderMarkdown('[clic](javascript:alert(1)) y [Manual: FZ "x" onmouseover=1, pag. 4]');
    expect(html).not.toMatch(/href|onmouseover=1"/);
    expect(html).toContain('<span class="cite">Manual: FZ &quot;x&quot; onmouseover=1, pag. 4</span>');
  });

  it('listas, titulos y tablas', () => {
    const html = renderMarkdown('## Aceite\n- 10W-40\n- JASO MA2\n\n1. uno\n2. dos\n\n| Pieza | Torque |\n|---|---|\n| Eje | 90 Nm |');
    expect(html).toContain('<h4>Aceite</h4>');
    expect(html).toContain('<ul><li>10W-40</li><li>JASO MA2</li></ul>');
    expect(html).toContain('<ol><li>uno</li><li>dos</li></ol>');
    expect(html).toContain('<th>Pieza</th>');
    expect(html).toContain('<td>90 Nm</td>');
  });
});
