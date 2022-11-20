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
    const duetId = APPSTATE.ItemModule[videoId].duetInfo.duetFromId;
    if (duetId != "0") {
      video.duetId = duetId;
    }
  } else {
    console.log("No APPSTATE found for video: " + videoId);
  }
}

for (const username of Object.keys(videos)) {
  test(`Update video stats for user ${username}`, async ({ page }) => {
    const processedVideos = new Set();

    await page.goto(`https://www.tiktok.com/@${username}`);
    await page
      .locator("[data-e2e=likes-count]")
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

      await page
        .locator("[data-e2e=user-post-item]")
        .last()
        .waitFor({ timeout: 15000 });
      // @ts-ignore
      APPSTATE = await page.evaluate(() => window.SIGI_STATE);
      const userVideos = [];
      for (const videoId of Object.keys(APPSTATE.ItemModule)) {
        if (!processedVideos.has(videoId)) {
          await processVideo(
            username,
            videos[username][videoId],
            videoId,
            APPSTATE
          );
          processedVideos.add(videoId);
          userVideos.push(videos[username][videoId]);
        }
      }

      for (let isDuet = 0; isDuet < 2; isDuet++) {
        const filteredVideos = userVideos.filter((video) =>
          isDuet ? video.duetId !== "0" : video.duetId === "0"
        );
        if (filteredVideos.length > 0) {
          await pushInfluxMetrics(
            [
              {
                name: "video",
                tags: [
                  { name: "user", value: username },
                  { name: "platform", value: "tiktok" },
                  { name: "source", value: "influencer-monitor" },
                  { name: "is_ad", value: 0 },
                  { name: "is_duet", value: isDuet },
                  { name: "video_id", value: "NA" },
                  { name: "group", value: "default" },
                ],
                fields: [
                  {
                    name: "views",
                    value: filteredVideos.reduce(
                      (acc, video) => acc + video.views,
                      0
                    ),
                  },
                  {
                    name: "likes",
                    value: filteredVideos.reduce(
                      (acc, video) => acc + video.likes,
                      0
                    ),
                  },
                  {
                    name: "comments",
                    value: filteredVideos.reduce(
                      (acc, video) => acc + video.comments,
                      0
                    ),
                  },
                  {
                    name: "shares",
                    value: filteredVideos.reduce(
                      (acc, video) => acc + video.shares,
                      0
                    ),
                  },
                ],
                timestamp: TIMESTAMP,
              },
            ],
            INFLUX_METRICS_URL,
            GRAFANA_CLOUD_ID,
            GRAFANA_API_KEY
          );
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
