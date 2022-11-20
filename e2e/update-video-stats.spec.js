// @ts-check
const { test } = require("@playwright/test");
const fs = require("fs");
import { pushInfluxMetrics } from "../utils/utils";

const usersData = fs.readFileSync("./users.json");
// @ts-ignore
const users = JSON.parse(usersData);

const videosData = fs.readFileSync("./videos.json");
// @ts-ignore
const videos = JSON.parse(videosData);

const { GRAFANA_CLOUD_ID, GRAFANA_API_KEY, INFLUX_METRICS_URL } = process.env;

const TIMESTAMP = Date.now() * 1000000;

/**
 * @param {string} username
 * @param {any} video
 * @param {string} videoId
 * @param {{ ItemModule: any }} [APPSTATE]
 */
async function processVideo(username, video, videoId, APPSTATE) {
  if (APPSTATE) {
    video.createTime = parseInt(APPSTATE.ItemModule[videoId].createTime);
    video.views = APPSTATE.ItemModule[videoId].stats.playCount;
    video.likes = APPSTATE.ItemModule[videoId].stats.diggCount;
    video.comments = APPSTATE.ItemModule[videoId].stats.commentCount;
    video.shares = APPSTATE.ItemModule[videoId].stats.shareCount;
    const isAd = APPSTATE.ItemModule[videoId].isAd ? 1 : 0;
    const duetId = APPSTATE.ItemModule[videoId].duetInfo.duetFromId;
    if (duetId != "0") {
      video.duetId = duetId;
    }
    await pushInfluxMetrics(
      [
        {
          name: "video",
          tags: [
            { name: "user", value: username },
            { name: "platform", value: "tiktok" },
            { name: "source", value: "influencer-monitor" },
            { name: "is_ad", value: isAd },
            { name: "is_duet", value: duetId != "0" ? 1 : 0 },
            { name: "video_id", value: "NA" },
            { name: "group", value: "default" },
          ],
          fields: [
            { name: "views", value: video.views },
            { name: "likes", value: video.likes },
            { name: "comments", value: video.comments },
            { name: "shares", value: video.shares },
          ],
          timestamp: TIMESTAMP,
        },
      ],
      INFLUX_METRICS_URL,
      GRAFANA_CLOUD_ID,
      GRAFANA_API_KEY
    );
  } else {
    console.log("No APPSTATE found for video: " + videoId);
  }
}

for (const username of Object.keys(videos)) {
  test(`Update video stats for user ${username}`, async ({ page }) => {
    const processedVideos = new Set();

    await page.goto(`https://www.tiktok.com/@${username}`);
    await page
      .locator("[data-e2e=user-post-item]")
      .last()
      .waitFor({ timeout: 15000 });
    // @ts-ignore
    let APPSTATE = await page.evaluate(() => window.SIGI_STATE);

    if (APPSTATE) {
      const { followerCount, videoCount, heartCount } =
        APPSTATE.UserModule.stats[username];
      users[username] = {
        followers: followerCount,
        likes: heartCount,
        videos: videoCount,
      };
      await pushInfluxMetrics(
        [
          {
            name: "user",
            tags: [
              { name: "user", value: username },
              { name: "platform", value: "tiktok" },
              { name: "source", value: "influencer-monitor" },
            ],
            fields: [
              { name: "followers", value: followerCount },
              { name: "likes", value: heartCount },
              { name: "posts", value: videoCount },
            ],
            timestamp: TIMESTAMP,
          },
        ],
        INFLUX_METRICS_URL,
        GRAFANA_CLOUD_ID,
        GRAFANA_API_KEY
      );

      for (const videoId of Object.keys(APPSTATE.ItemModule)) {
        if (!processedVideos.has(videoId)) {
          await processVideo(
            username,
            videos[username][videoId],
            videoId,
            APPSTATE
          );
          processedVideos.add(videoId);
        }
      }
    } else {
      console.log("No APPSTATE found for user " + username);
    }

    for (const videoId of Object.keys(videos[username])) {
      if (!processedVideos.has(videoId)) {
        await page.goto(`https://www.tiktok.com/@${username}/video/${videoId}`);
        let error = false;
        await page
          .locator("[data-e2e=browser-nickname] span")
          .last()
          .waitFor()
          .catch((err) => {
            console.log("Video not found: " + videoId);
            error = true;
          });
        if (!error) {
          // @ts-ignore
          APPSTATE = await page.evaluate(() => window.SIGI_STATE);
          await processVideo(videos[username][videoId], videoId, APPSTATE);
        }
      }
    }
  });
}

test.afterAll(async () => {
  fs.writeFileSync("./users.json", JSON.stringify(users));
  fs.writeFileSync("./videos.json", JSON.stringify(videos));
});
