import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 自持久化运行时绑定：账号与目标是动态数据，走 state.json 而非 schemastery 静态配置。 */
export interface RemoteApprovalState {
  accountId: string
  chatId: string
}

const EMPTY: RemoteApprovalState = { accountId: '', chatId: '' }

/** state.json 的极简读写；缺失或损坏时回退空绑定。 */
export class StateStore {
  constructor(private readonly file: string) {}

  read(): RemoteApprovalState {
    try {
      if (!existsSync(this.file)) return { ...EMPTY }
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<RemoteApprovalState>
      return {
        accountId: typeof raw.accountId === 'string' ? raw.accountId : '',
        chatId: typeof raw.chatId === 'string' ? raw.chatId : '',
      }
    } catch {
      return { ...EMPTY }
    }
  }

  write(state: RemoteApprovalState): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(state, null, 2), 'utf8')
  }
}
