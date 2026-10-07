// 終端機裡中文、全形符號與 emoji 占 2 格。截斷與對齊都要用顯示寬度算，
// 用字元數算的話，中文內容實際寬度會是預估的兩倍，整列就換行跑版。

const isWide = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||
  (cp >= 0x2e80 && cp <= 0x303e) ||
  (cp >= 0x3041 && cp <= 0x33ff) ||
  (cp >= 0x3400 && cp <= 0x4dbf) ||
  (cp >= 0x4e00 && cp <= 0x9fff) ||
  (cp >= 0xa000 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe4f) ||
  (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) ||
  (cp >= 0x1f300 && cp <= 0x1faff) ||
  (cp >= 0x20000 && cp <= 0x3fffd)

const charWidth = (ch: string): number => (isWide(ch.codePointAt(0) ?? 0) ? 2 : 1)

export const widthOf = (text: string): number => [...text].reduce((n, ch) => n + charWidth(ch), 0)

export const clip = (text: string, width: number): string => {
  if (widthOf(text) <= width) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = charWidth(ch)
    if (used + w > width - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

// 移除控制字元（C0、DEL、C1，含 ESC）。commit 訊息、檔名、工具輸出都可能藏終端機跳脫序列，
// 顯示前一律清掉，避免被當成指令改寫畫面或標題。字元以 fromCharCode 組成（mod 載入器處理反斜線有問題）。
const CONTROL = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}-${String.fromCharCode(159)}]`,
  'g',
)

export const clean = (text: string): string => text.replace(CONTROL, '')
