const { test } = require("@playwright/test");
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
import { parseNumberString, pushInfluxMetrics } from "../utils/utils";

const usersData = fs.readFileSync("./users.json");
const users = JSON.parse(usersData);

const videosData = fs.readFileSync("./videos.json");
const videos = JSON.parse(videosData);

const {
  DISCORD_TOKEN,
  VIDEO_CHANNEL_ID,
  GRAFANA_CLOUD_ID,
  GRAFANA_API_KEY,
  INFLUX_METRICS_URL,
} = process.env;

const client = new Client({ intents: [GatewayIntentBits.GuildMessages] });
let CHANNEL;

test.beforeAll(async () => {
  console.log("Logging into Discord...");
  await client.login(DISCORD_TOKEN);
  await new Promise((resolve) => {
    client.once("ready", resolve);
  });
  CHANNEL = await client.channels.fetch(VIDEO_CHANNEL_ID);
  console.log("Logged into Discord!");
});

for (const username of Object.keys(users)) {
  if (!videos[username]) {
    videos[username] = {};
  }
  test("Get new videos for user: " + username, async ({ page }) => {
    await page.goto("https://www.tiktok.com/@" + username);

    await page.locator("[data-e2e=followers-count]").waitFor();
    const followerCount = await page.$("[data-e2e=followers-count]");
    users[username].followers = parseNumberString(
      await followerCount.innerText()
    );

    await page.locator("[data-e2e=likes-count]").waitFor();
    const likeCount = await page.$("[data-e2e=likes-count]");
    users[username].likes = parseNumberString(await likeCount.innerText());

    const userMetric = {
      name: "user",
      tags: [
        { name: "user", value: username },
        { name: "platform", value: "tiktok" },
        { name: "source", value: "influencer-monitor" },
      ],
      fields: [{ name: "followers", value: users[username].followers }],
    };

    let APPSTATE = await page.evaluate(() => window.SIGI_STATE);
    if (APPSTATE) {
      users[username].videos = APPSTATE.UserModule.stats[username].videoCount;
      userMetric.fields.push({
        name: "videos",
        value: users[username].videos,
      });
    } else {
      console.log("No APPSTATE found for user " + username);
    }
    await pushInfluxMetrics(
      [userMetric],
      INFLUX_METRICS_URL,
      GRAFANA_CLOUD_ID,
      GRAFANA_API_KEY
    );

    await page
      .locator("[data-e2e=user-post-item]")
      .last()
      .waitFor({ timeout: 15000 });
    const videoItemList = await page.$("[data-e2e=user-post-item-list]");
    const videoItems = await videoItemList.$$("[data-e2e=user-post-item]");

    let newestVideoId;

    for (const videoItem of videoItems) {
      const videoUrl = await videoItem.$("a");
      const url = await videoUrl.getAttribute("href");
      const videoId = url.split("/video/")[1];
      if (!newestVideoId) {
        newestVideoId = videoId;
      }

      const videoViews = await videoItem.$("[data-e2e=video-views]");
      const views = parseNumberString(await videoViews.innerText());
      if (videos[username][videoId]) {
        console.log("Video is not new: " + videoId);
        videos[username][videoId].views = views;
        continue;
      } else {
        videos[username][videoId] = { views: views };
      }
      console.log("Posting new video: " + videoId);

      await CHANNEL.send(
        `User: ${username} | Followers: ${users[username].followers} | Likes: ${users[username].likes}\nViews: ${views} | Video: ${url}`
      );
    }

    if (newestVideoId) {
      users[username].lastProcessedVideo = newestVideoId;
    }
  });
}

test.afterAll(async () => {
  client.destroy();
  fs.writeFileSync("./users.json", JSON.stringify(users));
  fs.writeFileSync("./videos.json", JSON.stringify(videos));
});
