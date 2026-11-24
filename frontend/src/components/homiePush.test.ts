import { expect, it } from 'vitest'
import { movementReaction, pushDirection } from './homiePush'

const box = (x: number, y: number) => ({ left: x, right: x+20, top: y, bottom: y+20 })
const gnome = box(50, 50)

it('stumbles away from an approaching button or icon on each side', () => {
  expect(pushDirection(box(20,50), box(31,50), gnome)).toBe('right')
  expect(pushDirection(box(80,50), box(69,50), gnome)).toBe('left')
  expect(pushDirection(box(50,20), box(50,31), gnome)).toBe('down')
  expect(pushDirection(box(50,80), box(50,69), gnome)).toBe('up')
})

it('ignores a stationary neighbour, a retreating icon and a button moving in another row', () => {
  expect(pushDirection(box(31,50), box(31,50), gnome)).toBeNull()
  expect(pushDirection(box(31,50), box(25,50), gnome)).toBeNull()
  expect(pushDirection(box(20,10), box(31,10), gnome)).toBeNull()
})

it('lets a small passing icon stir a breeze while a wide button can knock him over', () => {
  expect(movementReaction(box(12,28), box(48,28), gnome)).toEqual({kind:'breeze',direction:'right'})
  expect(movementReaction(box(10,0), box(42,0), gnome)).toBeNull()
  expect(movementReaction(box(22,50), box(14,50), gnome)).toBeNull()
  expect(movementReaction({left:-20,right:35,top:50,bottom:75},
    {left:0,right:55,top:50,bottom:75}, gnome)).toEqual({kind:'roll',direction:'right'})
})
