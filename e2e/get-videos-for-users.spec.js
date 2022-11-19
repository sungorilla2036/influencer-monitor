const { test } = require("@playwright/test");
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
import fetch from "node-fetch";

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

/**
 *
 * @param {string} str
 * @returns
 */
function parseNumberString(str) {
  const lastCharactor = str[str.length - 1];
  const strShortened = str.slice(0, -1);
  if (lastCharactor === "K") {
    return parseFloat(strShortened) * 1000;
  } else if (lastCharactor === "M") {
    return parseFloat(strShortened) * 1000000;
  } else if (lastCharactor === "B") {
    return parseFloat(strShortened) * 1000000000;
  } else {
    return parseInt(str);
  }
}

async function pushInfluxMetrics(metrics) {
  let metricStrings = [];
  for (const metric of metrics) {
    // format: metric,tag1=value1,tag2=value2 field1=value1,field2=value2
    let metricString = metric.name + ",";
    for (const tag of metric.tags) {
      metricString += tag.name + "=" + tag.value + ",";
    }
    metricString = metricString.slice(0, -1);
    metricString += " ";
    for (const field of metric.fields) {
      metricString += field.name + "=" + field.value + ",";
    }
    metricString = metricString.slice(0, -1);
    metricStrings.push(metricString);
  }
  const response = await fetch(INFLUX_METRICS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GRAFANA_CLOUD_ID}:${GRAFANA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metricStrings.join("\n")),
  });
  return response;
}

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

    await pushInfluxMetrics([
      {
        name: "user",
        tags: [
          { name: "user", value: username },
          { name: "platform", value: "tiktok" },
          { name: "source", value: "influencer-monitor" },
        ],
        fields: [
          { name: "followers", value: users[username].followers },
          { name: "likes", value: users[username].likes },
        ],
      },
    ]);

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
