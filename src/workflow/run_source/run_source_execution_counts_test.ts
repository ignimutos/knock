import { assertEquals } from '../../testing/assert.ts'
import { test } from '../../testing/test_api.ts'
import {
  accumulateRunSourceExecutionCounts,
  createRunSourceExecutionCounts,
  createRunSourceLifecycleCounts,
  toRunSourceLifecycleCounts,
} from './run_source_execution_counts.ts'

test('[unit] runSourceExecutionCounts: 应初始化 run 级与 lifecycle 计数', () => {
  const aggregate = createRunSourceExecutionCounts(3)

  assertEquals(aggregate, {
    runCounts: {
      fetchedCount: 3,
      parsedCount: 3,
      filteredCount: 0,
      duplicateItemCount: 0,
      deliveredCount: 0,
      failedAttemptCount: 0,
      skippedCount: 0,
    },
    lifecycleCounts: {
      filteredCount: 0,
      dedupedCount: 0,
      pushedCount: 0,
      failedCount: 0,
    },
  })
})

test('[unit] runSourceExecutionCounts: 应累加单 item pipeline 的计数', () => {
  const aggregate = createRunSourceExecutionCounts(2)

  accumulateRunSourceExecutionCounts(aggregate, {
    counts: {
      filteredCount: 1,
      duplicateItemCount: 2,
      deliveredCount: 3,
      failedAttemptCount: 4,
      skippedCount: 5,
    },
    lifecycleCounts: {
      filteredCount: 6,
      dedupedCount: 7,
      pushedCount: 8,
      failedCount: 9,
    },
  })

  assertEquals(aggregate, {
    runCounts: {
      fetchedCount: 2,
      parsedCount: 2,
      filteredCount: 1,
      duplicateItemCount: 2,
      deliveredCount: 3,
      failedAttemptCount: 4,
      skippedCount: 5,
    },
    lifecycleCounts: {
      filteredCount: 6,
      dedupedCount: 7,
      pushedCount: 8,
      failedCount: 9,
    },
  })
})

test('[unit] runSourceExecutionCounts: 应连续累加多个 item pipeline 结果', () => {
  const aggregate = createRunSourceExecutionCounts(3)

  accumulateRunSourceExecutionCounts(aggregate, {
    counts: {
      filteredCount: 1,
      duplicateItemCount: 0,
      deliveredCount: 0,
      failedAttemptCount: 0,
      skippedCount: 0,
    },
    lifecycleCounts: {
      filteredCount: 1,
      dedupedCount: 0,
      pushedCount: 0,
      failedCount: 0,
    },
  })
  accumulateRunSourceExecutionCounts(aggregate, {
    counts: {
      filteredCount: 0,
      duplicateItemCount: 0,
      deliveredCount: 0,
      failedAttemptCount: 1,
      skippedCount: 1,
    },
    lifecycleCounts: {
      filteredCount: 0,
      dedupedCount: 0,
      pushedCount: 0,
      failedCount: 1,
    },
  })

  assertEquals(aggregate, {
    runCounts: {
      fetchedCount: 3,
      parsedCount: 3,
      filteredCount: 1,
      duplicateItemCount: 0,
      deliveredCount: 0,
      failedAttemptCount: 1,
      skippedCount: 1,
    },
    lifecycleCounts: {
      filteredCount: 1,
      dedupedCount: 0,
      pushedCount: 0,
      failedCount: 1,
    },
  })
})

test('[unit] runSourceExecutionCounts: 应构造 executor 使用的 lifecycle count shape', () => {
  assertEquals(createRunSourceLifecycleCounts(2), {
    sourceItemCount: 2,
    filteredCount: 0,
    dedupedCount: 0,
    pushedCount: 0,
    failedCount: 0,
  })

  assertEquals(
    toRunSourceLifecycleCounts(2, {
      filteredCount: 1,
      dedupedCount: 2,
      pushedCount: 3,
      failedCount: 4,
    }),
    {
      sourceItemCount: 2,
      filteredCount: 1,
      dedupedCount: 2,
      pushedCount: 3,
      failedCount: 4,
    },
  )
})
