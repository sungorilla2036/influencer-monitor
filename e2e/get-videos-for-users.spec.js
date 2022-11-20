// @ts-check
const { test } = require("@playwright/test");
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

const usersData = fs.readFileSync("./users.json");
// @ts-ignore
const users = JSON.parse(usersData);

const videosData = fs.readFileSync("./videos.json");
// @ts-ignore
const videos = JSON.parse(videosData);

const { DISCORD_TOKEN, VIDEO_CHANNEL_ID } = process.env;

const client = new Client({ intents: [GatewayIntentBits.GuildMessages] });
let CHANNEL;

test.beforeAll(async () => {
  console.log("Logging into Discord...");
  await client.login(DISCORD_TOKEN);
  await new Promise((resolve) => {
    client.once("ready", resolve);
  });
  // @ts-ignore
  CHANNEL = await client.channels.fetch(VIDEO_CHANNEL_ID);
  console.log("Logged into Discord!");
});

for (const username of Object.keys(users)) {
  if (!videos[username]) {
    videos[username] = {};
  }
  test("Get new videos for user: " + username, async ({ page }) => {
    await page.goto("https://www.tiktok.com/@" + username);

    let error = false;
    await page
      .locator("[data-e2e=user-post-item]")
      .last()
      .waitFor({ timeout: 15000 })
      .catch((err) => {
        console.log("Video not found for user: " + username);
        error = true;
      });

    if (error) {
      return;
    }

    // @ts-ignore
    let APPSTATE = await page.evaluate(() => window.SIGI_STATE);

    if (APPSTATE) {
      for (const videoItem of Object.values(APPSTATE.ItemModule)) {
        const authorStats = videoItem.authorStats;
        const videoStats = videoItem.stats;
        const videoId = videoItem.id;
        const videoUrl = `https://www.tiktok.com/@${username}/video/${videoId}`;

        if (videos[username][videoId]) {
          console.log("Video is not new: " + videoId);
          continue;
        }
        videos[username][videoId] = {
          createTime: parseInt(videoItem.createTime),
          views: videoStats.playCount,
          likes: videoStats.diggCount,
          comments: videoStats.commentCount,
          shares: videoStats.shareCount,
        };

        console.log("Posting new video: " + videoId);
        await CHANNEL.send(
          `User: ${username} | Followers: ${authorStats.followerCount} | Likes: ${authorStats.heartCount}\nViews: ${videoStats.playCount} | Comments: ${videoStats.commentCount} | Likes: ${videoStats.diggCount} | Shares: ${videoStats.shareCount} | Video: ${videoUrl}`
        );
      }
    } else {
      console.log("No APPSTATE found for user: " + username);
    }
  });
}

test.afterAll(async () => {
  client.destroy();
  fs.writeFileSync("./videos.json", JSON.stringify(videos));
});
