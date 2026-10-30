// ===== 本文マーカー（ハイライト）用：DOM テキストの索引と範囲特定 =====
// 書籍リーダー（/pdf/[id]）と論文リーダー（/reader/[pmid]）で共通利用する。
// 表示中の本文(root)配下の全テキストノードを連結し、空白を正規化した文字列を作る。
// 正規化インデックス→生インデックス(n2r)、生インデックス→ノード位置 を辿れるようにする。
import { findPositionInText } from './utils';

export type TextIndex = {
  nodes: { node: Text; start: number }[];
  norm: string;
  n2r: number[];
};

// テキストノードの「最寄りのブロック要素」を返す（インライン要素は飛ばして上る）。
// 洋書のように本文が複数の <p>/<h2> に分かれる場合、ブラウザの
// Selection.toString() はブロック境界に改行を挟む。索引側でも同じ位置に
// 区切りを入れないと、段落をまたいだ選択（手動マーカー・対訳印）が一致しない。
function nearestBlock(node: Node, root: HTMLElement): HTMLElement {
  let el: HTMLElement | null = node.parentElement;
  while (el && el !== root) {
    const d = getComputedStyle(el).display;
    if (d && !d.startsWith('inline') && d !== 'contents') return el;
    el = el.parentElement;
  }
  return root;
}

export function buildTextIndex(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number }[] = [];
  let raw = '';
  let n: Node | null;
  let prevBlock: HTMLElement | null = null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    // 直前のテキストノードと別ブロックなら、ブラウザの選択文字列に合わせて
    // 区切り（改行→正規化で半角空白に畳まれる）を挟む。同一ブロック内の
    // インライン分割では挟まない（語の途中に空白を作らないため）。
    const block = nearestBlock(tn, root);
    if (prevBlock && block !== prevBlock) raw += '\n';
    prevBlock = block;
    nodes.push({ node: tn, start: raw.length });
    raw += tn.textContent || '';
  }
  let norm = '';
  const n2r: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (/\s/.test(c)) {
      if (prevSpace) continue;
      norm += ' ';
      n2r.push(i);
      prevSpace = true;
    } else {
      norm += c;
      n2r.push(i);
      prevSpace = false;
    }
  }
  n2r.push(raw.length); // 末尾境界
  return { nodes, norm: norm.toLowerCase(), n2r };
}

export function rawToNode(
  nodes: { node: Text; start: number }[],
  pos: number,
): { node: Text; offset: number } | null {
  if (nodes.length === 0) return null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (pos >= nodes[i].start) {
      return { node: nodes[i].node, offset: pos - nodes[i].start };
    }
  }
  return { node: nodes[0].node, offset: 0 };
}

// DOM 位置(node, offset)を、buildTextIndex の正規化文字列内オフセットへ変換。
// マーカー作成時の選択位置を記録し、同一文字列が複数ある場合に「近い方」へ当てるために使う。
export function normOffsetForDom(idx: TextIndex, node: Node, offset: number): number | undefined {
  const entry = idx.nodes.find((x) => x.node === node);
  if (!entry) return undefined;
  const raw = entry.start + offset;
  // n2r[k] は正規化index→生index の昇順写像。raw 以下の最大 k を二分探索
  let lo = 0;
  let hi = idx.n2r.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.n2r[mid] <= raw) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

// 正規化空間のスパン [start,end)（idx.norm 基準）を DOM Range へ変換。
export function rangeForNormSpan(idx: TextIndex, start: number, end: number): Range | null {
  const last = idx.n2r.length - 1;
  const rawStart = idx.n2r[Math.max(0, Math.min(start, last))];
  const rawEnd = idx.n2r[Math.max(0, Math.min(end, last))];
  const s = rawToNode(idx.nodes, rawStart);
  const e = rawToNode(idx.nodes, rawEnd);
  if (!s || !e) return null;
  try {
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    return range;
  } catch {
    return null;
  }
}

// 位置特定レコードから、表示中の本文内での正規化スパン {start,end} を求める。
// マーカー描画・ホバー判定の双方で使う（同一文字列が複数あっても prefix/suffix/offset で識別）。
export function locateNormSpan(
  idx: TextIndex,
  rec: { text: string; prefix?: string; suffix?: string; approx_offset?: number },
): { start: number; end: number } | null {
  return findPositionInText(idx.norm, rec);
}

// マーカーに一致する DOM Range を求める（旧API互換: text + before(prefix) + anchor(offset)）。
// 同一文字列が本文に複数あるとき、prefix/suffix/offset で最も確からしい出現を選ぶ。
export function rangeForMarker(
  idx: TextIndex,
  text: string,
  before: string,
  anchor?: number,
): Range | null {
  const span = findPositionInText(idx.norm, { text, prefix: before, approx_offset: anchor });
  if (!span) return null;
  return rangeForNormSpan(idx, span.start, span.end);
}

export function rangesIntersect(a: Range, b: Range): boolean {
  try {
    return (
      a.compareBoundaryPoints(Range.END_TO_START, b) < 0 &&
      a.compareBoundaryPoints(Range.START_TO_END, b) > 0
    );
  } catch {
    return false;
  }
}

// 指定要素を内包する「実際にスクロールしている祖先」を返す。
// リーダーは本文ペインが overflow-y:auto なので、window ではなくこの要素を動かす。
export function scrollContainerOf(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) return p;
    p = p.parentElement;
  }
  return null;
}
