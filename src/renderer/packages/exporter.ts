import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

export default class WebExporter {
    constructor() {
    }

    async exportTextFile(filename: string, content: string) {
        const filePath = await save({
            defaultPath: `./${filename}`,
        });

        if (filePath) {
            await writeTextFile(filePath as string, content, {
                baseDir: BaseDirectory.AppConfig,
            });
        }
    }

}
