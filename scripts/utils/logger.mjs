import { SLACK_BOT_TOKEN, SLACK_CHANNEL } from "./base.mjs";

import { WebClient } from "@slack/web-api";
import { $, chalk } from "zx";
$.verbose = true;

class Logger {
  constructor() {
    if (SLACK_BOT_TOKEN && SLACK_CHANNEL) {
      this.slack = new WebClient(SLACK_BOT_TOKEN);
      this.channel = SLACK_CHANNEL;
    }
  }

  async task(message) {
    console.log(chalk.blue(message));
    if (this.slack) {
      await this.slack.chat.postMessage({ channel: this.channel, text: `🎯 *${message}*` });
    }
  }

  async step(message) {
    console.log(chalk.yellow(message));
    if (this.slack) {
      const text = `_*${message}*_`;
      await this.slack.chat.postMessage({ channel: this.channel, attachments: [{ color: "warning", text, fallback: text }] });
    }
  }

  async info(message) {
    console.log(chalk.green(message));
    if (this.slack) {
      const text = `_${message}_`;
      await this.slack.chat.postMessage({ channel: this.channel, attachments: [{ color: "good", text, fallback: text }] });
    }
  }

  async debug(message) {
    console.log(chalk.blue(message));
  }

  async error(message) {
    console.error(chalk.red(message));
    if (this.slack) {
      const text = `_${message}_`;
      await this.slack.chat.postMessage({ channel: this.channel, attachments: [{ color: "danger", text, fallback: text }] });
    }
  }
}

export default new Logger();
