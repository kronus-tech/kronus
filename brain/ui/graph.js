// Kronus Brain — D3 v7 force-directed knowledge graph
// No build step. Plain ES2020 served by Bun.serve as static files.

const API = ''; // same origin

let allNodes = [];
let allEdges = [];
let simulation;
let selectedNode = null;
let tooltip = null;
let currentSourceFilter = 'all';
let currentProjectFilter = 'all';
let pendingSelectNode = null;

// PARA type colors (match style.css variables)
const COLORS = {
  project:  '#3b82f6',
  area:     '#22c55e',
  resource: '#f59e0b',
  archive:  '#6b7280',
  inbox:    '#ef4444',
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [graphData, mapData] = await Promise.all([
    fetch(`${API}/api/graph`).then(r => r.json()),
    fetch(`${API}/api/map`).then(r => r.json()),
  ]);

  allNodes = graphData.nodes.map(n => ({
    ...n,
    tags: parseTags(n.tags),
  }));
  allEdges = graphData.edges;

  // Stats bar
  const t = mapData.totals ?? {};
  const total_nodes   = t.nodes   ?? mapData.total_nodes   ?? 0;
  const total_edges   = t.edges   ?? mapData.total_edges   ?? 0;
  const orphan_count  = t.orphans ?? mapData.orphan_count  ?? 0;
  const health        = mapData.health_score ?? 0;

  // Count by source
  const personalCount = allNodes.filter(n => (n.source_root ?? 'personal') === 'personal').length;
  const projectCount = allNodes.filter(n => (n.source_root ?? 'personal') === 'project').length;

  document.getElementById('stats').innerHTML =
    `<span class="counts">${personalCount} notes · ${projectCount} memories · ${total_edges} connections</span>` +
    `<span class="health" data-tip="You have ${personalCount} personal notes and ${projectCount} AI conversation memories. Link notes to each other with [[note name]] to build stronger connections and improve health.">Health: ${health > 1 ? Math.round(health) : (health * 100).toFixed(0)}%</span>`;

  // Populate project dropdown from node paths
  populateProjectDropdown();

  renderGraph(allNodes, allEdges);
  setupSourceFilters();
  setupProjectFilter();
  setupFilters();
  setupSearch();
}

function parseTags(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); }
  catch { return []; }
}

function showEmptyState(message) {
  const svg = d3.select('#graph');
  svg.selectAll('*').remove();
  const width = svg.node().clientWidth || window.innerWidth;
  const height = svg.node().clientHeight || window.innerHeight - 80;
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2 - 10)
    .attr('text-anchor', 'middle')
    .attr('fill', 'rgba(255,255,255,0.25)')
    .attr('font-size', '14px')
    .text(message);
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', height / 2 + 14)
    .attr('text-anchor', 'middle')
    .attr('fill', 'rgba(255,255,255,0.15)')
    .attr('font-size', '11px')
    .text('Try a different filter or create some notes');
}

// ─── Graph render ─────────────────────────────────────────────────────────────

function renderGraph(nodes, edges) {
  const svg = d3.select('#graph');
  svg.selectAll('*').remove();

  // Use parent container size, fallback to window — handles iframe embed
  const container = svg.node().parentElement;
  const width  = container?.clientWidth  || svg.node().clientWidth  || window.innerWidth;
  const height = container?.clientHeight || svg.node().clientHeight || (window.innerHeight - 76);

  // Zoom container
  const g = svg.append('g');
  const zoom = d3.zoom()
    .scaleExtent([0.05, 6])
    .on('zoom', event => g.attr('transform', event.transform));
  svg.call(zoom);

  // Build id → node map for link resolution
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  const links = edges
    .filter(e => nodeMap.has(e.source_id) && nodeMap.has(e.target_id))
    .map(e => ({
      source: e.source_id,
      target: e.target_id,
      type:   e.edge_type,
    }));

  // Precompute degree for node sizing
  const degree = new Map();
  for (const e of links) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  // ── Force simulation ──────────────────────────────────────────────────────
  // Group nodes by PARA type for clustering when few/no links exist
  const paraGroups = {};
  const paraTypes = ['project', 'area', 'resource', 'archive', 'inbox'];
  paraTypes.forEach((t, i) => { paraGroups[t] = { x: width * 0.3 + (i % 3) * width * 0.2, y: height * 0.35 + Math.floor(i / 3) * height * 0.3 }; });

  simulation = d3.forceSimulation(nodes)
    .force('link',
      d3.forceLink(links)
        .id(d => d.id)
        .distance(d => d.type === 'tag_co' ? 80 : 45)
        .strength(d => d.type === 'tag_co' ? 0.5 : 0.9)
    )
    .force('charge', d3.forceManyBody().strength(links.length > 0 ? -180 : -80))
    .force('center', d3.forceCenter(width / 2, height / 2).strength(0.15))
    .force('x', d3.forceX(d => (paraGroups[d.para_type] || paraGroups.inbox).x).strength(links.length > 0 ? 0.03 : 0.12))
    .force('y', d3.forceY(d => (paraGroups[d.para_type] || paraGroups.inbox).y).strength(links.length > 0 ? 0.03 : 0.12))
    .force('collision', d3.forceCollide().radius(d => {
      // Collision includes text width to prevent label overlap
      const r = nodeRadius(d, degree);
      const textLen = Math.min(d.title.length, 20) * 4.5;
      return r + textLen + 6;
    }).strength(0.8));

  // ── Links ─────────────────────────────────────────────────────────────────
  const link = g.append('g').attr('class', 'links')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('class', d => `link ${d.type || ''}`);

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const node = g.append('g').attr('class', 'nodes')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .attr('class', 'node')
    .call(
      d3.drag()
        .on('start', dragstarted)
        .on('drag',  dragged)
        .on('end',   dragended)
    );

  const connectedIds = new Set();
  for (const e of links) {
    connectedIds.add(typeof e.source === 'object' ? e.source.id : e.source);
    connectedIds.add(typeof e.target === 'object' ? e.target.id : e.target);
  }

  node.append('circle')
    .attr('r',              d => nodeRadius(d, degree))
    .attr('fill',           d => COLORS[d.para_type] || COLORS.inbox)
    .attr('fill-opacity',   d => nodeOpacity(d))
    .attr('stroke',         d => COLORS[d.para_type] || COLORS.inbox)
    .attr('stroke-opacity',  0.3)
    .attr('stroke-width',   d => connectedIds.has(d.id) ? 3 : 1)
    .attr('stroke-dasharray', d => d.source_root === 'project' ? '3,2' : 'none');

  node.append('text')
    .text(d => {
      const maxLen = nodes.length > 50 ? 18 : nodes.length > 20 ? 22 : 30;
      return d.title.length > maxLen ? d.title.slice(0, maxLen - 2) + '…' : d.title;
    })
    .attr('dx', d => nodeRadius(d, degree) + 4)
    .attr('dy', 2)
    .style('font-size', d => {
      const deg = degree.get(d.id) || 0;
      return deg > 3 ? '12px' : deg > 0 ? '11px' : '10px';
    });

  // Category + source label below title
  const PARA_LABELS = {
    project: 'Active',
    area: 'Topic',
    resource: 'Reference',
    archive: 'Archived',
    inbox: 'New',
  };
  node.append('text')
    .attr('class', 'para-label')
    .text(d => {
      const label = PARA_LABELS[d.para_type] || d.para_type;
      const src = d.source_root === 'project' ? ' · AI' : '';
      return label + src;
    })
    .attr('dx', d => nodeRadius(d, degree) + 3)
    .attr('dy', 11);

  // ── Events ────────────────────────────────────────────────────────────────
  node.selectAll('circle')
    .on('mouseover', showTooltip)
    .on('mousemove', moveTooltip)
    .on('mouseout',  hideTooltip);

  node.selectAll('text')
    .on('mouseover', showTooltip)
    .on('mousemove', moveTooltip)
    .on('mouseout',  hideTooltip);

  node
    .on('click',     (event, d) => { event.stopPropagation(); selectNode(d); })
    .on('dblclick',  (event, d) => { event.stopPropagation(); openInEditor(d.path); });

  // Click on background deselects
  svg.on('click', () => closeDetail());

  // ── Zoom-to-fit helper ───────────────────────────────────────────────────
  function zoomToFit(animate) {
    if (nodes.length === 0) return;
    const pad = 60;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const bw = (maxX - minX) || 100;
    const bh = (maxY - minY) || 100;
    const scale = Math.min(width / (bw + pad * 2), height / (bh + pad * 2), 1.5);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = width / 2 - cx * scale;
    const ty = height / 2 - cy * scale;
    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    if (animate) {
      svg.transition().duration(400).call(zoom.transform, transform);
    } else {
      svg.call(zoom.transform, transform);
    }
  }

  // ── Tick ─────────────────────────────────────────────────────────────────
  let tickCount = 0;
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);

    // Fit to view early (no animation) so user never sees zoomed-in state
    tickCount++;
    if (tickCount === 1) zoomToFit(false);
  });

  // Final fit after stabilization (smooth)
  simulation.on('end', () => {
    zoomToFit(true);

    if (pendingSelectNode) {
      selectNode(pendingSelectNode);
      pendingSelectNode = null;
    }
  });
}

// ─── Node helpers ─────────────────────────────────────────────────────────────

function nodeRadius(d, degree) {
  const deg = degree ? (degree.get(d.id) || 0) : 0;
  return Math.max(5, Math.min(14, 5 + deg * 1.5));
}

function nodeOpacity(d) {
  if (!d.modified_at) return 0.7;
  const daysSince = (Date.now() - new Date(d.modified_at).getTime()) / 86_400_000;
  return daysSince < 30 ? 1 : 0.5;
}

function lighten(hex) {
  return hex + 'cc';
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function ensureTooltip() {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function showTooltip(event, d) {
  const el = ensureTooltip();
  const tags = d.tags || [];
  const tagStr = tags.length ? tags.map(t => '#' + t).join(' ') : '';
  const source = d.source_root === 'project' ? '📁 AI memory' : '🧠 your note';
  el.innerHTML =
    `<strong>${d.title}</strong><br>` +
    `${d.para_type} · ${d.word_count ?? 0} words · ${source}` +
    (tagStr ? `<br><span style="color:#F97316;font-size:10px">${tagStr}</span>` : '');
  el.style.display = 'block';
  moveTooltip(event);
}

function moveTooltip(event) {
  if (!tooltip) return;
  tooltip.style.left = (event.clientX + 14) + 'px';
  tooltip.style.top  = (event.clientY - 10) + 'px';
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

// ─── Node selection + detail panel ───────────────────────────────────────────

async function selectNode(d) {
  selectedNode = d;
  hideTooltip();

  const detail = document.getElementById('detail');
  detail.classList.remove('hidden');

  document.getElementById('detail-title').textContent = d.title;
  const sourceLabel = d.source_root === 'project' ? 'AI Memory' : 'Your Note';
  const DETAIL_PARA = { project: 'Active Work', area: 'Topic', resource: 'Reference', archive: 'Archived', inbox: 'New' };
  document.getElementById('detail-meta').innerHTML =
    `<div class="meta-row"><span class="meta-label">Source</span><span class="meta-value source-badge ${d.source_root ?? 'personal'}">${sourceLabel}</span></div>` +
    `<div class="meta-row"><span class="meta-label">Category</span><span class="meta-value">${DETAIL_PARA[d.para_type] || d.para_type}</span></div>` +
    `<div class="meta-row"><span class="meta-label">Location</span><span class="meta-value">${d.path}</span></div>` +
    `<div class="meta-row"><span class="meta-label">Size</span><span class="meta-value">${d.word_count ?? 0} words</span></div>` +
    (d.status ? `<div class="meta-row"><span class="meta-label">Status</span><span class="meta-value">${d.status}</span></div>` : '') +
    (d.modified_at ? `<div class="meta-row"><span class="meta-label">Last changed</span><span class="meta-value">${new Date(d.modified_at).toLocaleDateString()}</span></div>` : '');

  document.getElementById('detail-tags').innerHTML =
    (d.tags || []).map(t => `<span>#${t}</span>`).join('');

  // Clear link lists while loading
  document.querySelector('#detail-outlinks ul').innerHTML = '<li style="color:var(--text-muted)">Loading...</li>';
  document.querySelector('#detail-backlinks ul').innerHTML = '';

  // Fetch full graph context for this node
  try {
    const nodeData = await fetch(`${API}/api/node?path=${encodeURIComponent(d.path)}`).then(r => r.json());

    const outlinks  = nodeData.outlinks  || [];
    const backlinks = nodeData.backlinks || [];

    const outUl = document.querySelector('#detail-outlinks ul');
    outUl.innerHTML = outlinks.length
      ? outlinks.map(l =>
          `<li onclick="selectNodeByPath('${escAttr(l.path)}')">${escHtml(l.title)}</li>`
        ).join('')
      : '<li style="color:var(--text-muted);cursor:default">None</li>';

    const backUl = document.querySelector('#detail-backlinks ul');
    backUl.innerHTML = backlinks.length
      ? backlinks.map(l =>
          `<li onclick="selectNodeByPath('${escAttr(l.path)}')">${escHtml(l.title)}</li>`
        ).join('')
      : '<li style="color:var(--text-muted);cursor:default">None</li>';
  } catch {
    document.querySelector('#detail-outlinks ul').innerHTML =
      '<li style="color:var(--text-muted);cursor:default">Error loading</li>';
  }

  // Highlight selected node — thin accent ring
  d3.selectAll('.node circle')
    .classed('selected', n => n === d);
  d3.selectAll('.node circle')
    .attr('stroke-width', n => n === d ? 4 : 2);

  // Update URL hash for deep linking
  window.location.hash = encodeURIComponent(d.path);
}

function selectNodeByPath(path) {
  const n = allNodes.find(n => n.path === path);
  if (n) selectNode(n);
}

function selectNodeByTitle(title) {
  const lower = title.toLowerCase();
  const n = allNodes.find(n =>
    n.title.toLowerCase() === lower ||
    n.path.toLowerCase().includes(lower.replace(/\s+/g, '-'))
  );
  if (n) selectNode(n);
}

// ─── Close detail ─────────────────────────────────────────────────────────────

function closeDetail() {
  const detail = document.getElementById('detail');
  detail.classList.add('hidden');
  // Clear selection ring
  d3.selectAll('.node circle').classed('selected', false).attr('stroke-width', 2);
  d3.selectAll('.node circle')
    .attr('stroke', d => {
      const connectedIds = new Set();
      allEdges.forEach(e => { connectedIds.add(e.source_id); connectedIds.add(e.target_id); });
      return connectedIds.has(d.id) ? lighten(COLORS[d.para_type] || COLORS.inbox) : '#ef4444';
    });
  // Hide content preview
  const contentEl = document.getElementById('detail-content');
  contentEl.classList.add('hidden');
  contentEl.innerHTML = '';
  document.getElementById('btn-preview').textContent = 'View Content';
  selectedNode = null;
  window.location.hash = '';
}

document.getElementById('close-detail').addEventListener('click', e => {
  e.stopPropagation();
  closeDetail();
});

// ─── Open in editor ───────────────────────────────────────────────────────────

document.getElementById('btn-open').addEventListener('click', () => {
  if (selectedNode) openInEditor(selectedNode.path);
});

function openInEditor(path) {
  fetch(`${API}/api/open?path=${encodeURIComponent(path)}`);
}

// ─── View content ────────────────────────────────────────────────────────────

document.getElementById('btn-preview').addEventListener('click', async () => {
  if (!selectedNode) return;
  const contentEl = document.getElementById('detail-content');
  const btn = document.getElementById('btn-preview');

  // Toggle: if already showing, hide
  if (!contentEl.classList.contains('hidden')) {
    contentEl.classList.add('hidden');
    contentEl.innerHTML = '';
    btn.textContent = 'View Content';
    return;
  }

  btn.textContent = 'Loading...';
  try {
    const result = await fetch(`${API}/api/content?path=${encodeURIComponent(selectedNode.path)}`).then(r => r.json());
    if (result.error) {
      contentEl.innerHTML = `<div class="content-error">${escHtml(result.error)}</div>`;
    } else {
      // Simple markdown rendering: headings, bold, italic, links, lists, code
      contentEl.innerHTML = renderMarkdown(result.content);
    }
    contentEl.classList.remove('hidden');
    btn.textContent = 'Hide Content';
  } catch {
    contentEl.innerHTML = '<div class="content-error">Could not load content</div>';
    contentEl.classList.remove('hidden');
    btn.textContent = 'Hide Content';
  }
});

// Simple markdown → HTML (no external dependencies)
function renderMarkdown(md) {
  // Strip frontmatter
  let text = md.replace(/^---[\s\S]*?---\n*/m, '');

  // Escape HTML first
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');

  // Headings
  text = text.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links [[wikilink]] — onclick navigates graph
  text = text.replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink" onclick="selectNodeByTitle(\'$1\')">$1</span>');

  // Links [text](url) — .md links navigate graph, others open externally
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
    if (href.endsWith('.md') || !href.includes('://')) {
      return `<span class="wikilink" onclick="selectNodeByPath('${href.replace(/'/g, "\\'")}')">${label}</span>`;
    }
    return `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  });

  // Unordered lists
  text = text.replace(/^- (.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  // Collapse adjacent <ul> tags
  text = text.replace(/<\/ul>\s*<ul>/g, '');

  // Tables (basic)
  text = text.replace(/^\|(.+)\|$/gm, (match, content) => {
    const cells = content.split('|').map(c => c.trim());
    if (cells.every(c => /^[-:]+$/.test(c))) return ''; // separator row
    const tag = 'td';
    return '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
  });
  text = text.replace(/(<tr>[\s\S]*?<\/tr>)/g, '<table>$1</table>');
  text = text.replace(/<\/table>\s*<table>/g, '');

  // Paragraphs (double newlines)
  text = text.replace(/\n\n+/g, '</p><p>');
  text = '<p>' + text + '</p>';

  // Clean up empty paragraphs
  text = text.replace(/<p>\s*<\/p>/g, '');
  text = text.replace(/<p>(<h[1-4]>)/g, '$1');
  text = text.replace(/(<\/h[1-4]>)<\/p>/g, '$1');
  text = text.replace(/<p>(<pre>)/g, '$1');
  text = text.replace(/(<\/pre>)<\/p>/g, '$1');
  text = text.replace(/<p>(<ul>)/g, '$1');
  text = text.replace(/(<\/ul>)<\/p>/g, '$1');
  text = text.replace(/<p>(<table>)/g, '$1');
  text = text.replace(/(<\/table>)<\/p>/g, '$1');

  return text;
}

// ─── Copy path ────────────────────────────────────────────────────────────────

document.getElementById('btn-copy-path').addEventListener('click', async () => {
  if (!selectedNode) return;
  try {
    await navigator.clipboard.writeText(selectedNode.path);
    const btn = document.getElementById('btn-copy-path');
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch { /* clipboard not available in non-secure contexts */ }
});

// ─── Path finding ─────────────────────────────────────────────────────────────

document.getElementById('path-to').addEventListener('keydown', async e => {
  if (e.key !== 'Enter' || !selectedNode) return;

  const toVal = e.target.value.trim();
  if (!toVal) return;

  // Try to match by title or path prefix
  const target = allNodes.find(n =>
    n.path === toVal ||
    n.title.toLowerCase() === toVal.toLowerCase() ||
    n.path.toLowerCase().includes(toVal.toLowerCase())
  );

  const toPath = target ? target.path : toVal;

  try {
    const result = await fetch(
      `${API}/api/path?from=${encodeURIComponent(selectedNode.path)}&to=${encodeURIComponent(toPath)}`
    ).then(r => r.json());

    if (result.found) {
      const pathSet = new Set(result.path.map(p => p.path));
      d3.selectAll('.node circle')
        .attr('stroke',       d => pathSet.has(d.path) ? '#a78bfa' : (COLORS[d.para_type] || COLORS.inbox))
        .attr('stroke-width', d => pathSet.has(d.path) ? 4 : 2);
      d3.selectAll('.link')
        .classed('highlighted', d => {
          const sp = typeof d.source === 'object' ? d.source.path : '';
          const tp = typeof d.target === 'object' ? d.target.path : '';
          return pathSet.has(sp) && pathSet.has(tp);
        });
    } else {
      e.target.placeholder = 'No path found';
      e.target.value = '';
    }
  } catch {
    e.target.placeholder = 'Error finding path';
    e.target.value = '';
  }
});

// ─── Source filters ───────────────────────────────────────────────────────────

function getSourceFiltered() {
  let nodes = allNodes;

  // Source filter
  if (currentSourceFilter !== 'all') {
    nodes = nodes.filter(n => (n.source_root ?? 'personal') === currentSourceFilter);
  }

  // Project filter (only applies to project memories)
  if (currentProjectFilter !== 'all') {
    nodes = nodes.filter(n => {
      if ((n.source_root ?? 'personal') === 'personal') return true; // always show personal
      return extractProjectName(n.path) === currentProjectFilter;
    });
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = allEdges.filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id));
  return { nodes, edges };
}

function extractProjectName(path) {
  // Path format: -Users-USERNAME-Desktop-FOLDER-PROJECT/memory/file.md
  // Project name is everything before /memory/
  const idx = path.indexOf('/memory/');
  if (idx > 0) return path.substring(0, idx);
  // Fallback: first path segment
  return path.split('/')[0] || path;
}

function cleanProjectDisplay(raw) {
  // -Users-USERNAME-Desktop-FOLDER-my-project → my-project
  // -Users-USERNAME-Desktop-work-client → work / client
  return raw
    .replace(/-Users-[^-]+-Desktop-[^-]+-/i, '')
    .replace(/-Users-[^-]+-Desktop-/i, '')
    .replace(/-Users-[^-]+-/i, '')
    .replace(/^-/, '')
    .replace(/-/g, ' / ');
}

function populateProjectDropdown() {
  const select = document.getElementById('project-filter');
  const projects = new Map(); // raw → count

  for (const n of allNodes) {
    if ((n.source_root ?? 'personal') === 'project') {
      const proj = extractProjectName(n.path);
      projects.set(proj, (projects.get(proj) || 0) + 1);
    }
  }

  const sorted = [...projects.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [proj, count] of sorted) {
    const opt = document.createElement('option');
    opt.value = proj;
    opt.textContent = `${cleanProjectDisplay(proj)} (${count})`;
    select.appendChild(opt);
  }
}

function setupProjectFilter() {
  document.getElementById('project-filter').addEventListener('change', (e) => {
    currentProjectFilter = e.target.value;
    const { nodes, edges } = getSourceFiltered();
    if (nodes.length === 0) {
      showEmptyState('No notes for this project');
    } else {
      renderGraph(nodes, edges);
    }
  });
}

function setupSourceFilters() {
  document.querySelectorAll('.source-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.source-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSourceFilter = btn.dataset.source;

      // Reset PARA filter to "All"
      document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
      document.querySelector('.filter[data-type="all"]').classList.add('active');

      const { nodes, edges } = getSourceFiltered();
      if (nodes.length === 0) {
        showEmptyState(`No ${currentSourceFilter} notes`);
      } else {
        renderGraph(nodes, edges);
      }
    });
  });
}

// ─── PARA filters ─────────────────────────────────────────────────────────────

function setupFilters() {
  document.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const type = btn.dataset.type;
      const { nodes: sourceNodes, edges: sourceEdges } = getSourceFiltered();

      if (type === 'all') {
        renderGraph(sourceNodes, sourceEdges);
        return;
      }

      if (type === 'orphan') {
        const connectedIds = new Set();
        sourceEdges.forEach(e => { connectedIds.add(e.source_id); connectedIds.add(e.target_id); });
        const orphans = sourceNodes.filter(n => !connectedIds.has(n.id));
        if (orphans.length === 0) { showEmptyState('No orphan notes'); return; }
        renderGraph(orphans, []);
        return;
      }

      const filtered = sourceNodes.filter(n => n.para_type === type);
      if (filtered.length === 0) {
        showEmptyState(`No ${type} notes yet`);
        return;
      }
      const filteredIds = new Set(filtered.map(n => n.id));
      const filteredEdges = sourceEdges.filter(
        e => filteredIds.has(e.source_id) && filteredIds.has(e.target_id)
      );
      renderGraph(filtered, filteredEdges);
    });
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

function setupSearch() {
  const feedback = document.getElementById('search-feedback');
  const input = document.getElementById('search');
  let debounce;

  function clearSearch() {
    input.value = '';
    feedback.textContent = '';
    feedback.className = '';
    d3.selectAll('.node circle').attr('opacity', d => nodeOpacity(d));
    d3.selectAll('.node text').attr('opacity', 1);
    d3.selectAll('.node .para-label').attr('opacity', 1);
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearSearch();
  });

  input.addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      const q = e.target.value.trim();

      if (!q) {
        clearSearch();
        return;
      }

      try {
        const result = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
        const matches = result.results || [];
        const matchPaths = new Set(matches.map(r => r.path));

        if (matches.length === 0) {
          feedback.textContent = 'No results';
          feedback.className = 'danger';
        } else {
          feedback.textContent = `${matches.length} match${matches.length === 1 ? '' : 'es'}`;
          feedback.className = '';
        }

        d3.selectAll('.node circle')
          .attr('opacity', d => matchPaths.has(d.path) ? 1 : 0.06);
        d3.selectAll('.node text')
          .attr('opacity', d => matchPaths.has(d.path) ? 1 : 0.04);
        d3.selectAll('.node .para-label')
          .attr('opacity', d => matchPaths.has(d.path) ? 1 : 0.04);
      } catch {
        feedback.textContent = 'Search unavailable';
        feedback.className = 'danger';
      }
    }, 300);
  });
}

// ─── Drag handlers ────────────────────────────────────────────────────────────

function dragstarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
}

function dragended(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}

// ─── String escape helpers ────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

// ─── Resize observer ─────────────────────────────────────────────────────────

let resizeDebounce;
new ResizeObserver(() => {
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(() => {
    if (allNodes.length === 0) return;
    // Re-apply current source filter on resize instead of resetting to all
    const { nodes, edges } = getSourceFiltered();
    renderGraph(nodes, edges);
  }, 200);
}).observe(document.getElementById('graph'));

// ─── Deep linking via URL hash ────────────────────────────────────────────────

// ─── Theme ───────────────────────────────────────────────────────────────────

function initTheme() {
  // Priority: URL param > system preference > default dark
  const params = new URLSearchParams(window.location.search);
  const paramTheme = params.get('theme');
  if (paramTheme === 'light' || paramTheme === 'dark') {
    document.documentElement.dataset.theme = paramTheme;
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.dataset.theme = 'light';
  }
  updateThemeIcons();
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = current === 'light' ? 'dark' : 'light';
  updateThemeIcons();
}

function updateThemeIcons() {
  const isLight = document.documentElement.dataset.theme === 'light';
  document.getElementById('icon-sun').style.display = isLight ? 'none' : 'block';
  document.getElementById('icon-moon').style.display = isLight ? 'block' : 'none';
}

document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// ─── Init ────────────────────────────────────────────────────────────────────

window.addEventListener('load', async () => {
  initTheme();
  await init();

  const hash = window.location.hash.slice(1);
  if (hash) {
    const path = decodeURIComponent(hash);
    const n = allNodes.find(n => n.path === path);
    if (n) pendingSelectNode = n;
  }
});
