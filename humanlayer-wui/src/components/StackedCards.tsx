import * as React from 'react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

const VISIBLE_CARDS = 3
const GAP = 14
const TIME_BEFORE_UNMOUNT = 200

interface CardItem {
  id: string
  content: React.ReactNode
}

interface StackedCardsProps {
  cards: CardItem[]
  onDismiss?: (cardId: string) => void
  className?: string
  gap?: number
  visibleCards?: number
}

export function StackedCards({ 
  cards, 
  onDismiss,
  className,
  gap = GAP,
  visibleCards = VISIBLE_CARDS
}: StackedCardsProps) {
  const [removedCards, setRemovedCards] = React.useState<Set<string>>(new Set())
  const [mountedCards, setMountedCards] = React.useState<Set<string>>(new Set())

  const activeCards = React.useMemo(
    () => cards.filter(card => !removedCards.has(card.id)),
    [cards, removedCards]
  )

  // Initialize mounted cards immediately
  const initialMountedCards = React.useMemo(() => {
    return new Set(cards.map(card => card.id))
  }, [cards])

  const dismissCard = React.useCallback((cardId: string) => {
    setRemovedCards(prev => new Set(prev).add(cardId))
    
    setTimeout(() => {
      onDismiss?.(cardId)
      setRemovedCards(prev => {
        const next = new Set(prev)
        next.delete(cardId)
        return next
      })
    }, TIME_BEFORE_UNMOUNT)
  }, [onDismiss])

  React.useEffect(() => {
    // Mount all cards that aren't already mounted
    const newMounted = new Set(mountedCards)
    activeCards.forEach(card => {
      if (!newMounted.has(card.id)) {
        newMounted.add(card.id)
      }
    })
    if (newMounted.size !== mountedCards.size) {
      setMountedCards(newMounted)
    }
  }, [activeCards, mountedCards])

  // Use initial mounted cards if no cards are currently mounted
  const effectiveMountedCards = mountedCards.size > 0 ? mountedCards : initialMountedCards

  return (
    <div 
      className={cn(
        'relative',
        className
      )}
      style={{
        '--gap': `${gap}px`,
        '--visible-cards': visibleCards
      } as React.CSSProperties}
    >
      {activeCards.map((card, index) => (
        <StackedCard
          key={card.id}
          card={card}
          index={index}
          visibleCards={visibleCards}
          gap={gap}
          onDismiss={() => dismissCard(card.id)}
          isRemoved={removedCards.has(card.id)}
          isMounted={effectiveMountedCards.has(card.id)}
          totalCards={activeCards.length}
        />
      ))}
    </div>
  )
}

interface StackedCardProps {
  card: CardItem
  index: number
  visibleCards: number
  gap: number
  onDismiss: () => void
  isRemoved: boolean
  isMounted: boolean
  totalCards: number
}

function StackedCard({
  card,
  index,
  visibleCards,
  gap,
  onDismiss,
  isRemoved,
  isMounted,
  totalCards
}: StackedCardProps) {
  const cardRef = React.useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = React.useState<number | null>(null)
  
  const isFront = index === 0
  const isVisible = index < visibleCards
  const toastsBefore = Math.min(index, visibleCards - 1)

  // Measure card height once when mounted
  React.useLayoutEffect(() => {
    if (cardRef.current && cardHeight === null) {
      const height = cardRef.current.getBoundingClientRect().height
      setCardHeight(height)
    }
  }, [cardHeight])

  const scale = React.useMemo(() => {
    if (isFront) return 1
    return 1 - (toastsBefore * 0.03)
  }, [isFront, toastsBefore])

  const yTransform = React.useMemo(() => {
    if (isRemoved && isFront) {
      return -120
    }
    if (isRemoved && !isFront) {
      return 40
    }
    if (!isMounted) {
      return 100
    }
    // Stack cards behind with negative offset to show them peeking
    return -(toastsBefore * gap)
  }, [isRemoved, isFront, isMounted, toastsBefore, gap])

  const opacity = React.useMemo(() => {
    if (isRemoved) return 0
    if (!isMounted) return 0
    if (!isVisible) return 0
    return 1
  }, [isRemoved, isMounted, isVisible])

  return (
    <div
      ref={cardRef}
      className={cn(
        'absolute bottom-0 left-0 right-0 transition-all duration-400',
        'outline-none touch-none',
        !isVisible && 'pointer-events-none'
      )}
      style={{
        transform: `translateY(${yTransform}px) scale(${scale})`,
        opacity,
        zIndex: totalCards - index,
        transformOrigin: 'center bottom',
        transition: 'transform 400ms cubic-bezier(0.32, 0.72, 0, 1), opacity 400ms cubic-bezier(0.32, 0.72, 0, 1)',
      }}
      data-front={isFront}
      data-visible={isVisible}
      data-mounted={isMounted}
      data-removed={isRemoved}
    >
      <Card 
        className={cn(
          'cursor-pointer select-none',
          'shadow-lg',
          isFront && 'hover:shadow-xl',
          !isFront && 'opacity-90'
        )}
        onClick={isFront ? onDismiss : undefined}
      >
        {card.content}
      </Card>
    </div>
  )
}