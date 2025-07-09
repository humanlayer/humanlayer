import React, { Fragment } from 'react'

// --- Minimal diff utilities (no third-party libraries) ---
function computeLineDiff(oldStr: string, newStr: string) {
  // Returns an array of { type: 'equal'|'add'|'remove'|'replace', oldLine?: string, newLine?: string, oldIndex?: number, newIndex?: number }
  // Simple LCS-based diff for lines
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const n = oldLines.length
  const m = newLines.length
  // LCS table
  const dp: number[][] = Array(n + 1)
    .fill(0)
    .map(() => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1]
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }
  // Backtrack to get diff
  let i = 0,
    j = 0
  const diff: any[] = []
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      diff.push({ type: 'equal', oldLine: oldLines[i], newLine: newLines[j], oldIndex: i, newIndex: j })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'remove', oldLine: oldLines[i], oldIndex: i })
      i++
    } else {
      diff.push({ type: 'add', newLine: newLines[j], newIndex: j })
      j++
    }
  }
  while (i < n) {
    diff.push({ type: 'remove', oldLine: oldLines[i], oldIndex: i })
    i++
  }
  while (j < m) {
    diff.push({ type: 'add', newLine: newLines[j], newIndex: j })
    j++
  }
  // Post-process: merge adjacent add/remove into replace
  const merged: any[] = []
  let k = 0
  while (k < diff.length) {
    if (diff[k].type === 'remove' && k + 1 < diff.length && diff[k + 1].type === 'add') {
      merged.push({
        type: 'replace',
        oldLine: diff[k].oldLine,
        newLine: diff[k + 1].newLine,
        oldIndex: diff[k].oldIndex,
        newIndex: diff[k + 1].newIndex,
      })
      k += 2
    } else {
      merged.push(diff[k])
      k++
    }
  }
  return merged
}

function tokenizeLine(line: string): string[] {
  // Split by word boundaries while keeping the delimiters
  const tokens: string[] = []
  let current = ''

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const isWordChar = /\w/.test(char)
    const prevIsWordChar = current.length > 0 && /\w/.test(current[current.length - 1])

    if (current.length > 0 && isWordChar !== prevIsWordChar) {
      tokens.push(current)
      current = char
    } else {
      current += char
    }
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}

function computeWordDiff(oldLine: string, newLine: string) {
  // Returns [{text, type: 'equal'|'add'|'remove'}]
  // LCS-based word diff
  const a = tokenizeLine(oldLine)
  const b = tokenizeLine(newLine)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array(n + 1)
    .fill(0)
    .map(() => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1]
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }
  let i = 0,
    j = 0
  const result: any[] = []
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ text: a[i], type: 'equal' })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ text: a[i], type: 'remove' })
      i++
    } else {
      result.push({ text: b[j], type: 'add' })
      j++
    }
  }
  while (i < n) {
    result.push({ text: a[i], type: 'remove' })
    i++
  }
  while (j < m) {
    result.push({ text: b[j], type: 'add' })
    j++
  }
  return result
}

// --- CustomDiffViewer implementation ---
export const CustomDiffViewer = ({
  fileContents,
  edits,
  splitView = false, // default to unified
}: {
  fileContents?: string
  edits: { oldValue: string; newValue: string }[]
  splitView?: boolean
}) => {
  // Case 1: No full fileContents provided. Diff only the edits without context or line numbers.
  if (!fileContents) {
    return (
      <div className="relative">
        {edits.map((edit, editIdx) => {
          const diff = computeLineDiff(edit.oldValue, edit.newValue)

          if (splitView) {
            const linePairs = diff.map((d, i) => {
              const key = `diff-row-${editIdx}-${i}`
              let leftContent: React.ReactNode
              let rightContent: React.ReactNode

              switch (d.type) {
                case 'equal':
                  leftContent = (
                    <div className="bg-transparent text-muted-foreground px-2 whitespace-pre-wrap">
                      {d.oldLine}
                    </div>
                  )
                  rightContent = (
                    <div className="bg-transparent text-muted-foreground px-2 whitespace-pre-wrap">
                      {d.newLine}
                    </div>
                  )
                  break
                case 'remove':
                  leftContent = (
                    <div className="bg-[var(--terminal-error)]/10 text-foreground px-2 whitespace-pre-wrap">
                      {d.oldLine}
                    </div>
                  )
                  rightContent = <div className="h-[1.2em]">&nbsp;</div>
                  break
                case 'add':
                  leftContent = <div className="h-[1.2em]">&nbsp;</div>
                  rightContent = (
                    <div className="bg-[var(--terminal-success)]/10 text-foreground px-2 whitespace-pre-wrap">
                      {d.newLine}
                    </div>
                  )
                  break
                case 'replace':
                  leftContent = (
                    <div className="bg-[var(--terminal-error)]/10 text-foreground px-2 whitespace-pre-wrap">
                      {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                        if (c.type === 'add') return null
                        return c.type === 'remove' ? (
                          <span key={j} className="bg-[var(--terminal-error)]/40">
                            {c.text}
                          </span>
                        ) : (
                          <span key={j}>{c.text}</span>
                        )
                      })}
                    </div>
                  )
                  rightContent = (
                    <div className="bg-[var(--terminal-success)]/10 text-foreground px-2 whitespace-pre-wrap">
                      {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                        if (c.type === 'remove') return null
                        return c.type === 'add' ? (
                          <span key={j} className="bg-[var(--terminal-success)]/40">
                            {c.text}
                          </span>
                        ) : (
                          <span key={j}>{c.text}</span>
                        )
                      })}
                    </div>
                  )
                  break
              }
              return { key, left: leftContent, right: rightContent }
            })

            return (
              <div
                key={editIdx}
                className={`text-xs font-mono ${editIdx > 0 ? 'mt-2 pt-2 border-t border-dashed' : ''}`}
              >
                <div className="flex flex-row">
                  <div className="w-1/2 pr-2 border-r border-border">
                    {linePairs.map(p =>
                      React.cloneElement(p.left as React.ReactElement, { key: `left-${p.key}` }),
                    )}
                  </div>
                  <div className="w-1/2 pl-2">
                    {linePairs.map(p =>
                      React.cloneElement(p.right as React.ReactElement, { key: `right-${p.key}` }),
                    )}
                  </div>
                </div>
              </div>
            )
          }

          // --- Unified View (no fileContents) for each edit ---
          return (
            <div
              key={editIdx}
              className={`text-xs font-mono whitespace-pre-wrap ${editIdx > 0 ? 'mt-2 pt-2 border-t border-dashed' : ''}`}
            >
              {diff.map((d, i) => {
                if (d.type === 'replace') {
                  return (
                    <Fragment key={`rep-${i}`}>
                      <div className="flex items-start bg-[var(--terminal-error)]/10 text-foreground px-2">
                        <span className="w-4 select-none pr-2 text-foreground">-</span>
                        <span>
                          {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                            if (c.type === 'add') return null
                            return c.type === 'remove' ? (
                              <span key={j} className="bg-[var(--terminal-error)]/40">
                                {c.text}
                              </span>
                            ) : (
                              <span key={j}>{c.text}</span>
                            )
                          })}
                        </span>
                      </div>
                      <div className="flex items-start bg-[var(--terminal-success)]/10 text-foreground px-2">
                        <span className="w-4 select-none pr-2 text-foreground">+</span>
                        <span>
                          {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                            if (c.type === 'remove') return null
                            return c.type === 'add' ? (
                              <span key={j} className="bg-[var(--terminal-success)]/40">
                                {c.text}
                              </span>
                            ) : (
                              <span key={j}>{c.text}</span>
                            )
                          })}
                        </span>
                      </div>
                    </Fragment>
                  )
                }
                if (d.type === 'add') {
                  return (
                    <div
                      key={`add-${i}`}
                      className="flex items-start bg-[var(--terminal-success)]/10 text-foreground px-2"
                    >
                      <span className="w-4 select-none pr-2 text-foreground">+</span>
                      <span>{d.newLine}</span>
                    </div>
                  )
                }
                if (d.type === 'remove') {
                  return (
                    <div
                      key={`rem-${i}`}
                      className="flex items-start bg-[var(--terminal-error)]/10 text-foreground px-2"
                    >
                      <span className="w-4 select-none pr-2 text-foreground">-</span>
                      <span>{d.oldLine}</span>
                    </div>
                  )
                }
                // Equal
                return (
                  <div
                    key={`eq-${i}`}
                    className="flex items-start bg-transparent text-muted-foreground px-2"
                  >
                    <span className="w-4 select-none pr-2"> </span>
                    <span>{d.oldLine}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  // Case 2: Full fileContents provided. Show context and line numbers.
  let before = fileContents
  let after = fileContents

  // Apply all edits in order to produce the 'after' state
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]
    const idx = after.indexOf(edit.oldValue)
    if (idx === -1) {
      return (
        <div className="p-4 bg-[var(--terminal-error)]/10 text-foreground font-mono rounded">
          Error: The string to change for edit {i + 1} was not found in the file. Diff cannot be
          displayed.
        </div>
      )
    }
    // Replace only the first occurrence
    after = after.slice(0, idx) + edit.newValue + after.slice(idx + edit.oldValue.length)
  }

  // Compute the diff between before and after
  const diff = computeLineDiff(before, after)
  // Find changed line indices for context
  const changedIndices = diff
    .map((d, i) => (d.type !== 'equal' ? i : null))
    .filter(i => i !== null) as number[]
  // Compute context windows (line indices in the diff array)
  const contextSet = new Set<number>()
  changedIndices.forEach(idx => {
    for (let d = -2; d <= 2; d++) {
      if (idx + d >= 0 && idx + d < diff.length) contextSet.add(idx + d)
    }
  })
  // Build a map from oldIndex/newIndex to diff index for quick lookup
  const oldIdxToDiffIdx = new Map<number, number>()
  const newIdxToDiffIdx = new Map<number, number>()
  diff.forEach((d, i) => {
    if (d.oldIndex !== undefined) oldIdxToDiffIdx.set(d.oldIndex, i)
    if (d.newIndex !== undefined) newIdxToDiffIdx.set(d.newIndex, i)
  })
  const oldLines = before.split('\n')
  const newLines = after.split('\n')

  if (splitView) {
    return (
      <div className="relative">
        <div className="flex flex-row text-xs font-mono">
          {/* Left: old file with context */}
          <div className="w-1/2 pr-2 border-r border-border">
            {Array.from(new Set(diff.map(d => d.oldIndex).filter(idx => idx !== undefined && idx >= 0)))
              .sort((a, b) => (a as number) - (b as number))
              .map(idx => {
                if (typeof idx !== 'number') return null
                const diffIdx = oldIdxToDiffIdx.get(idx)
                if (diffIdx === undefined || !contextSet.has(diffIdx)) {
                  return null
                }

                const d = diff[diffIdx]
                const lineNumber = idx + 1

                if (d.type === 'replace') {
                  return (
                    <div key={idx} className="flex items-start">
                      <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                        {lineNumber}
                      </span>
                      <span className="flex-1 bg-[var(--terminal-error)]/10 text-foreground px-2 whitespace-pre-wrap">
                        {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                          if (c.type === 'add') return null
                          return c.type === 'remove' ? (
                            <span key={j} className="bg-[var(--terminal-error)]/40">
                              {c.text}
                            </span>
                          ) : (
                            <span key={j}>{c.text}</span>
                          )
                        })}
                      </span>
                    </div>
                  )
                }
                if (d.type === 'remove') {
                  return (
                    <div key={idx} className="flex items-start">
                      <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                        {lineNumber}
                      </span>
                      <span className="flex-1 bg-[var(--terminal-error)]/10 text-foreground px-2 whitespace-pre-wrap">
                        {d.oldLine}
                      </span>
                    </div>
                  )
                }
                // This is an 'equal' line within the context
                return (
                  <div key={idx} className="flex items-start">
                    <span className="w-8 text-right text-muted-foreground/40 select-none pr-2">
                      {lineNumber}
                    </span>
                    <span className="flex-1 bg-transparent text-muted-foreground px-2 whitespace-pre-wrap">
                      {oldLines[idx]}
                    </span>
                  </div>
                )
              })}
          </div>
          {/* Right: new file with context */}
          <div className="w-1/2 pl-2">
            {Array.from(new Set(diff.map(d => d.newIndex).filter(idx => idx !== undefined && idx >= 0)))
              .sort((a, b) => (a as number) - (b as number))
              .map(idx => {
                if (typeof idx !== 'number') return null
                const diffIdx = newIdxToDiffIdx.get(idx)
                if (diffIdx === undefined || !contextSet.has(diffIdx)) {
                  return null
                }

                const d = diff[diffIdx]
                const lineNumber = idx + 1

                if (d.type === 'replace') {
                  return (
                    <div key={idx} className="flex items-start">
                      <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                        {lineNumber}
                      </span>
                      <span className="flex-1 bg-[var(--terminal-success)]/10 text-foreground px-2 whitespace-pre-wrap">
                        {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                          if (c.type === 'remove') return null
                          return c.type === 'add' ? (
                            <span key={j} className="bg-[var(--terminal-success)]/40">
                              {c.text}
                            </span>
                          ) : (
                            <span key={j}>{c.text}</span>
                          )
                        })}
                      </span>
                    </div>
                  )
                }
                if (d.type === 'add') {
                  return (
                    <div key={idx} className="flex items-start">
                      <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                        {lineNumber}
                      </span>
                      <span className="flex-1 bg-[var(--terminal-success)]/10 text-foreground px-2 whitespace-pre-wrap">
                        {d.newLine}
                      </span>
                    </div>
                  )
                }
                // This is an 'equal' line within the context
                return (
                  <div key={idx} className="flex items-start">
                    <span className="w-8 text-right text-muted-foreground/40 select-none pr-2">
                      {lineNumber}
                    </span>
                    <span className="flex-1 bg-transparent text-muted-foreground px-2 whitespace-pre-wrap">
                      {newLines[idx]}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    )
  }

  // --- Unified View ---
  return (
    <div className="relative">
      <div className="text-xs font-mono whitespace-pre-wrap">
        {diff.map((d, i) => {
          if (!contextSet.has(i)) return null

          if (d.type === 'replace') {
            const oldLineNumber = d.oldIndex! + 1
            const newLineNumber = d.newIndex! + 1
            return (
              <Fragment key={`rep-${i}`}>
                <div className="flex items-start bg-[var(--terminal-error)]/10 text-foreground">
                  <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                    {oldLineNumber}
                  </span>
                  <span className="w-4 select-none text-foreground">-</span>
                  <span>
                    {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                      if (c.type === 'add') return null
                      return c.type === 'remove' ? (
                        <span key={j} className="bg-[var(--terminal-error)]/40">
                          {c.text}
                        </span>
                      ) : (
                        <span key={j}>{c.text}</span>
                      )
                    })}
                  </span>
                </div>
                <div className="flex items-start bg-[var(--terminal-success)]/10 text-foreground">
                  <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                    {newLineNumber}
                  </span>
                  <span className="w-4 select-none text-foreground">+</span>
                  <span>
                    {computeWordDiff(d.oldLine || '', d.newLine || '').map((c, j) => {
                      if (c.type === 'remove') return null
                      return c.type === 'add' ? (
                        <span key={j} className="bg-[var(--terminal-success)]/40">
                          {c.text}
                        </span>
                      ) : (
                        <span key={j}>{c.text}</span>
                      )
                    })}
                  </span>
                </div>
              </Fragment>
            )
          }

          if (d.type === 'add') {
            const lineNumber = d.newIndex! + 1
            return (
              <div
                key={`add-${i}`}
                className="flex items-start bg-[var(--terminal-success)]/10 text-foreground"
              >
                <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                  {lineNumber}
                </span>
                <span className="w-4 select-none text-foreground">+</span>
                <span>{d.newLine}</span>
              </div>
            )
          }

          if (d.type === 'remove') {
            const lineNumber = d.oldIndex! + 1
            return (
              <div
                key={`rem-${i}`}
                className="flex items-start bg-[var(--terminal-error)]/10 text-foreground"
              >
                <span className="w-8 text-right text-muted-foreground/60 select-none pr-2">
                  {lineNumber}
                </span>
                <span className="w-4 select-none text-foreground">-</span>
                <span>{d.oldLine}</span>
              </div>
            )
          }

          // Equal
          const lineNumber = d.oldIndex! + 1
          return (
            <div key={`eq-${i}`} className="flex items-start bg-transparent text-muted-foreground">
              <span className="w-8 text-right text-muted-foreground/40 select-none pr-2">
                {lineNumber}
              </span>
              <span className="w-4 select-none"> </span>
              <span>{d.oldLine}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
