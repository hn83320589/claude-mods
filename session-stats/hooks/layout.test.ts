import { expect, test } from 'claude-code/testing'

import { fit, pick, share, splitRows } from './layout'

test('三區平均分配，除不盡的列數給最後一區', async () => {
  expect(splitRows(30, 3)).toEqual([10, 10, 10])
  expect(splitRows(32, 3)).toEqual([10, 10, 12])
})

test('pane 太矮時每區至少保留 4 列', async () => {
  expect(splitRows(6, 3)).toEqual([4, 4, 4])
})

test('放不下時保留一列給「還有 N 項」', async () => {
  expect(fit([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 })
  expect(fit([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], more: 3 })
})

test('pick 依優先序挑列，但保持原本順序', async () => {
  const rows = [
    { item: 'model', priority: 1 },
    { item: 'context', priority: 10 },
    { item: 'weather', priority: 9 },
  ]
  expect(pick(rows, 2)).toEqual(['context', 'weather'])
  expect(pick(rows, 5)).toEqual(['model', 'context', 'weather'])
})

test('share 上段依比例分配，並保留下段最少列數', async () => {
  expect(share(10, 8, 0.4, 4)).toEqual({ upper: 4, lower: 6 })
  expect(share(10, 2, 0.4, 4)).toEqual({ upper: 2, lower: 8 })
  expect(share(5, 8, 0.6, 4)).toEqual({ upper: 1, lower: 4 })
})
