import { describe, it, expect } from 'vitest'
import { OutputBuffer } from '../../src/runtime/output-buffer'

describe('OutputBuffer', () => {
  it('stores written data and returns it via capture', () => {
    const buf = new OutputBuffer(100)
    buf.write('Hello world\r\n')
    buf.write('Second line\r\n')
    expect(buf.capture()).toContain('Hello world')
    expect(buf.capture()).toContain('Second line')
  })

  it('respects max lines limit', () => {
    const buf = new OutputBuffer(3)
    buf.write('line1\r\nline2\r\nline3\r\nline4\r\nline5\r\n')
    const captured = buf.capture()
    expect(captured).not.toContain('line1')
    expect(captured).not.toContain('line2')
    expect(captured).toContain('line3')
    expect(captured).toContain('line4')
    expect(captured).toContain('line5')
  })

  it('capture with lineCount returns only last N lines', () => {
    const buf = new OutputBuffer(100)
    buf.write('a\r\nb\r\nc\r\nd\r\n')
    const last2 = buf.capture(2)
    expect(last2).not.toContain('a')
    expect(last2).not.toContain('b')
    expect(last2).toContain('c')
    expect(last2).toContain('d')
  })

  it('handles data without trailing newline', () => {
    const buf = new OutputBuffer(100)
    buf.write('partial')
    expect(buf.capture()).toContain('partial')
  })

  it('strips ANSI escape codes when capturing', () => {
    const buf = new OutputBuffer(100)
    buf.write('\x1b[32mgreen text\x1b[0m\r\n')
    expect(buf.capture()).toContain('green text')
    expect(buf.capture()).not.toContain('\x1b')
  })

  it('includes(text) searches the buffer content', () => {
    const buf = new OutputBuffer(100)
    buf.write('Agent is ready >\r\n')
    expect(buf.includes('ready')).toBe(true)
    expect(buf.includes('nothere')).toBe(false)
  })
})
