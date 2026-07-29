import { useEffect, useRef } from 'react'

// Attaches one IntersectionObserver watching every registered node, and adds
// `visibleClass` the first time each node crosses the threshold. One-shot by
// design (unobserve on reveal) — scrolling back up should not replay it.
export function useScrollReveal<T extends HTMLElement>(
  count: number,
  visibleClass = 'story-node-visible',
) {
  const refs = useRef<(T | null)[]>([])

  useEffect(() => {
    const nodes = refs.current.filter((el): el is T => el !== null)
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(visibleClass)
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.2 },
    )

    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
  }, [count, visibleClass])

  return (index: number) => (el: T | null) => {
    refs.current[index] = el
  }
}
