const { test } = require("@playwright/test");
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

const usersData = fs.readFileSync("./users.json");
const users = JSON.parse(usersData);

const videosData = fs.readFileSync("./videos.json");
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
    users[username].followers = await followerCount.innerText();

    await page.locator("[data-e2e=likes-count]").waitFor();
    const likeCount = await page.$("[data-e2e=likes-count]");
    users[username].likes = await likeCount.innerText();

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
      if (videoId === users[username].lastProcessedVideo) {
        console.log("No more new videos for user: " + username);
        //break;
      }
      console.log("Processing video: " + videoId);
      const videoViews = await videoItem.$("[data-e2e=video-views]");
      const views = await videoViews.innerText();

      if (!videos[username][videoId]) {
        videos[username][videoId] = {};
      }
      videos[username][videoId].views = views;
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
