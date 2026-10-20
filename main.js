var obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    serverUrl: '',
    username: '',
    password: '',
    authToken: '',
    pollInterval: 3000,
    chatFilePath: 'Chatroom.md'
};

module.exports = class ChatroomPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ChatroomSettingTab(this.app, this));
        this.startPolling();

        this.addCommand({
            id: 'open-chatroom-file',
            name: 'Open Chatroom Note',
            callback: () => this.openChatFile()
        });
    }

    onunload() {
        this.stopPolling();
    }

    startPolling() {
        this.stopPolling();
        this.intervalId = window.setInterval(() => {
            this.fetchMessages();
        }, this.settings.pollInterval);
    }

    stopPolling() {
        if (this.intervalId !== null) {
            window.clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    async authenticate() {
        if (!this.settings.serverUrl || !this.settings.username || !this.settings.password) return false;

        try {
            const res = await fetch(`${this.settings.serverUrl.replace(/\/$/, '')}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user: this.settings.username,
                    pass: this.settings.password
                })
            });

            if (!res.ok) return false;

            const data = await res.json();
            if (data.token) {
                this.settings.authToken = data.token;
                await this.saveData(this.settings);
                return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    async fetchMessages() {
        if (!this.settings.serverUrl) return;

        if (!this.settings.authToken && this.settings.username && this.settings.password) {
            await this.authenticate();
        }

        const headers = { 'Content-Type': 'application/json' };

        if (this.settings.authToken) {
            headers['Authorization'] = `Bearer ${this.settings.authToken}`;
        }

        try {
            let response = await fetch(`${this.settings.serverUrl.replace(/\/$/, '')}/read`, { headers });

            if (response.status === 401 && this.settings.password) {
                const loggedIn = await this.authenticate();
                if (loggedIn) {
                    headers['Authorization'] = `Bearer ${this.settings.authToken}`;
                    response = await fetch(`${this.settings.serverUrl.replace(/\/$/, '')}/read`, { headers });
                }
            }

            if (!response.ok) return;

            const data = await response.json();
            const msgs = data.messages;
            if (!Array.isArray(msgs) || msgs.length === 0) return;

            if (this.lastMessageCount === undefined || this.lastMessageCount === 0) {
                this.lastMessageCount = msgs.length;
                return;
            }

            if (msgs.length > this.lastMessageCount) {
                const newMsgs = msgs.slice(this.lastMessageCount);
                this.lastMessageCount = msgs.length;

                for (const msg of newMsgs) {
                    if (msg.user !== this.settings.username) {
                        new obsidian.Notice(`💬 ${msg.user}: ${msg.text}`, 5000);
                    }
                    await this.appendMessageToNote(msg);
                }
            }
        } catch (e) {
            // silent fail
        }
    }

    async appendMessageToNote(msg) {
        const file = this.app.vault.getAbstractFileByPath(this.settings.chatFilePath);
        const timeStr = msg.time ? new Date(msg.time).toLocaleTimeString() : new Date().toLocaleTimeString();
        const formattedLine = `\n> **[${timeStr}] ${msg.user}:** ${msg.text}\n`;

        if (file && 'extension' in file) {
            await this.app.vault.append(file, formattedLine);
        } else {
            await this.app.vault.create(this.settings.chatFilePath, `# Chatroom Logs\n${formattedLine}`);
        }
    }

    async openChatFile() {
        const file = this.app.vault.getAbstractFileByPath(this.settings.chatFilePath);
        if (file && 'extension' in file) {
            const leaf = this.app.workspace.getUnsplitLeaf();
            await leaf.openFile(file);
        } else {
            const newFile = await this.app.vault.create(this.settings.chatFilePath, '# Chatroom Logs\n');
            const leaf = this.app.workspace.getUnsplitLeaf();
            await leaf.openFile(newFile);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.startPolling();
    }
};

class ChatroomSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Chatroom Worker Settings' });

        new obsidian.Setting(containerEl)
            .setName('Worker URL')
            .setDesc('Your Cloudflare Worker base URL')
            .addText(text => text
                .setPlaceholder('https://your-worker.workers.dev')
                .setValue(this.plugin.settings.serverUrl)
                .onChange(async (value) => {
                    this.plugin.settings.serverUrl = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Username')
            .setDesc('Your chat account username')
            .addText(text => text
                .setPlaceholder('Leon')
                .setValue(this.plugin.settings.username)
                .onChange(async (value) => {
                    this.plugin.settings.username = value;
                    await this.plugin.saveSettings();
                }));

        new obsidian.Setting(containerEl)
            .setName('Password')
            .setDesc('Your chat account password')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('••••••••')
                    .setValue(this.plugin.settings.password)
                    .onChange(async (value) => {
                        this.plugin.settings.password = value;
                        await this.plugin.saveSettings();
                    });
            });

        new obsidian.Setting(containerEl)
            .setName('Poll Interval (ms)')
            .setDesc('How often to check /read')
            .addText(text => text
                .setPlaceholder('3000')
                .setValue(String(this.plugin.settings.pollInterval))
                .onChange(async (value) => {
                    const num = parseInt(value, 10);
                    if (!isNaN(num) && num >= 1000) {
                        this.plugin.settings.pollInterval = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new obsidian.Setting(containerEl)
            .setName('Chat Log File')
            .setDesc('Markdown file path inside vault')
            .addText(text => text
                .setPlaceholder('Chatroom.md')
                .setValue(this.plugin.settings.chatFilePath)
                .onChange(async (value) => {
                    this.plugin.settings.chatFilePath = value;
                    await this.plugin.saveSettings();
                }));
    }
}
