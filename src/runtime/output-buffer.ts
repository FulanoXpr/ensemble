const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)/g

export class OutputBuffer {
  private lines: string[] = []
  private partial = ''

  constructor(private readonly maxLines: number = 2000) {}

  write(data: string): void {
    const text = this.partial + data
    const parts = text.split(/\r?\n/)
    this.partial = parts.pop() ?? ''

    for (const line of parts) {
      this.lines.push(line)
    }

    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(this.lines.length - this.maxLines)
    }
  }

  capture(lineCount?: number): string {
    const allLines = this.partial
      ? [...this.lines, this.partial]
      : [...this.lines]

    const selected = lineCount
      ? allLines.slice(-lineCount)
      : allLines

    return selected
      .map(line => line.replace(ANSI_REGEX, ''))
      .join('\n')
  }

  includes(text: string): boolean {
    return this.capture().includes(text)
  }

  clear(): void {
    this.lines = []
    this.partial = ''
  }
}
