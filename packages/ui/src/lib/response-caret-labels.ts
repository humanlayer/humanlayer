/** Keep name tags outside scroll/contain clipping without changing editor layout.
 * Manual popovers retain inherited theme tokens and never take keyboard focus. */
export function mountResponseCaretLabels(editor: HTMLElement) {
  const win = editor.ownerDocument.defaultView!
  let frame: number | undefined
  const update = () => {
    frame = undefined
    const clips: { rect: DOMRect; x: boolean; y: boolean }[] = []
    for (let node: HTMLElement | null = editor; node; node = node.parentElement) {
      const style = win.getComputedStyle(node)
      const x = /auto|scroll|hidden|clip/.test(style.overflowX)
      const y = /auto|scroll|hidden|clip/.test(style.overflowY)
      if (x || y) clips.push({ rect: node.getBoundingClientRect(), x, y })
    }
    for (const caret of editor.querySelectorAll<HTMLElement>('.response-caret')) {
      const label = caret.querySelector<HTMLElement>('.response-caret-label')
      if (!label?.showPopover) continue
      const rect = caret.getBoundingClientRect()
      const visible = rect.bottom > 0 && rect.top < win.innerHeight && rect.right > 0 && rect.left < win.innerWidth &&
        clips.every((clip) => (!clip.x || (rect.right > clip.rect.left && rect.left < clip.rect.right)) &&
          (!clip.y || (rect.bottom > clip.rect.top && rect.top < clip.rect.bottom)))
      if (!visible) {
        label.hidePopover()
        continue
      }
      label.showPopover()
      const size = label.getBoundingClientRect()
      label.style.left = `${Math.max(0, Math.min(rect.left, win.innerWidth - size.width))}px`
      label.style.top = `${Math.max(0, rect.top - size.height)}px`
    }
  }
  const schedule = () => {
    if (frame === undefined) frame = win.requestAnimationFrame(update)
  }
  // Capture nested editor/panel scrolling; resize also covers wrapping and panel resizing.
  editor.ownerDocument.addEventListener('scroll', schedule, true)
  win.addEventListener('resize', schedule)
  const observer = typeof win.ResizeObserver === 'undefined' ? undefined : new win.ResizeObserver(schedule)
  for (let node: HTMLElement | null = editor; observer && node; node = node.parentElement) observer.observe(node)
  schedule()
  return {
    update: schedule,
    destroy() {
      if (frame !== undefined) win.cancelAnimationFrame(frame)
      observer?.disconnect()
      editor.ownerDocument.removeEventListener('scroll', schedule, true)
      win.removeEventListener('resize', schedule)
      for (const label of editor.querySelectorAll<HTMLElement>('.response-caret-label')) label.hidePopover?.()
    },
  }
}
