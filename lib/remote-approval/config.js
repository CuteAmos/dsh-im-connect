import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const EMPTY = { accountId: '', chatId: '' };
/** state.json 的极简读写；缺失或损坏时回退空绑定。 */
export class StateStore {
    file;
    constructor(file) {
        this.file = file;
    }
    read() {
        try {
            if (!existsSync(this.file))
                return { ...EMPTY };
            const raw = JSON.parse(readFileSync(this.file, 'utf8'));
            return {
                accountId: typeof raw.accountId === 'string' ? raw.accountId : '',
                chatId: typeof raw.chatId === 'string' ? raw.chatId : '',
            };
        }
        catch {
            return { ...EMPTY };
        }
    }
    write(state) {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, JSON.stringify(state, null, 2), 'utf8');
    }
}
//# sourceMappingURL=config.js.map