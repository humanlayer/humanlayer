import * as React from 'react'
import { StackedCards } from '@/components/StackedCards'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface DemoCard {
  id: string
  title: string
  description: string
  content: string
}

const initialCards: DemoCard[] = [
  {
    id: '1',
    title: 'First Card',
    description: 'This is the top card',
    content: 'Click this card to dismiss it and see the next one in the stack.',
  },
  {
    id: '2',
    title: 'Second Card',
    description: 'This card was behind the first',
    content: 'When you dismissed the first card, this one animated to the front.',
  },
  {
    id: '3',
    title: 'Third Card',
    description: 'Previously at the bottom of the visible stack',
    content: 'This card scaled and moved up when the cards above were dismissed.',
  },
  {
    id: '4',
    title: 'Fourth Card',
    description: 'Was hidden, now visible',
    content: 'This card became visible when there was room in the stack.',
  },
  {
    id: '5',
    title: 'Fifth Card',
    description: 'Another hidden card',
    content: 'Cards beyond the visible limit fade in as space becomes available.',
  },
  {
    id: '6',
    title: 'Sixth Card',
    description: 'Even more content',
    content: 'The stack can handle any number of cards efficiently.',
  },
  {
    id: '7',
    title: 'Seventh Card',
    description: 'Lucky number seven',
    content: 'Keep clicking to see how smooth the animations are!',
  },
  {
    id: '8',
    title: 'Final Card',
    description: 'The last card in the demo',
    content: 'You\'ve reached the end of the stack. Click "Reset Stack" to start over.',
  },
]

export default function StackedCardsDemo() {
  const [cards, setCards] = React.useState(initialCards)
  const [dismissedCount, setDismissedCount] = React.useState(0)

  const handleDismiss = (cardId: string) => {
    setCards(prev => prev.filter(card => card.id !== cardId))
    setDismissedCount(prev => prev + 1)
  }

  const resetStack = () => {
    setCards(initialCards)
    setDismissedCount(0)
  }

  const addCard = () => {
    const newCard: DemoCard = {
      id: `new-${Date.now()}`,
      title: `New Card #${cards.length + 1}`,
      description: 'Dynamically added card',
      content: 'This card was added to the bottom of the stack.',
    }
    setCards(prev => [...prev, newCard])
  }

  const stackedCards = cards.map(card => ({
    id: card.id,
    content: (
      <>
        <CardHeader>
          <CardTitle>{card.title}</CardTitle>
          <CardDescription>{card.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{card.content}</p>
        </CardContent>
      </>
    ),
  }))

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Stacked Cards Demo</h1>
          <p className="text-muted-foreground">
            A demo of the stacked cards component inspired by Sonner's toast stacking. Click on the top
            card to dismiss it.
          </p>
        </div>

        <div className="flex gap-4">
          <Button onClick={resetStack} variant="outline">
            Reset Stack
          </Button>
          <Button onClick={addCard} variant="outline">
            Add Card
          </Button>
          <div className="ml-auto text-sm text-muted-foreground">
            Cards remaining: {cards.length} | Dismissed: {dismissedCount}
          </div>
        </div>

        <div className="relative h-[400px] flex items-end justify-center">
          <div className="w-full max-w-md relative" style={{ minHeight: '200px' }}>
            <StackedCards
              cards={stackedCards}
              onDismiss={handleDismiss}
              visibleCards={3}
              gap={20}
              className="h-full"
            />
          </div>
        </div>

        <div className="border rounded-lg p-4 space-y-2">
          <h2 className="font-semibold">How it works:</h2>
          <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
            <li>Only the top 3 cards are visible at any time</li>
            <li>Cards behind the front card are scaled down slightly</li>
            <li>When a card is dismissed, it animates out and the stack reorganizes</li>
            <li>New cards slide in from the bottom as space becomes available</li>
            <li>The animation timing and easing matches modern UI expectations</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
