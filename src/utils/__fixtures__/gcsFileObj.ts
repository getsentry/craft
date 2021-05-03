// Note: All but the last two objects in this file (the ones which are exported)
// exist purely because real-life GCS File objects are enormous, deeply nested,
// and full of repetition, so breaking them up is the only way to have any idea
// of what's in them.

const acl = {
  owners: {},
  readers: {},
  writers: {},
  pathPrefix: "/acl",
};

const defaultAcl = {
  ...acl,
  pathPrefix: "/defaultObjectAcl",
};

const aclWithDefault = {
  ...acl,
  default: defaultAcl,
};

const aclRoles = {
  OWNER_ROLE: "OWNER",
  READER_ROLE: "READER",
  WRITER_ROLE: "WRITER",
};

const scopes = [
  "https://www.googleapis.com/auth/iam",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/devstorage.full_control",
];

const authClient = {
  jsonContent: {
    client_email: "mighty_huntress@dogs.com",
    private_key: "DoGsArEgReAtSoMeSeCrEtStUfFhErE",
  },
  cachedCredential: {
    domain: null,
    _events: {},
    _eventsCount: 0,
    transporter: {},
    credentials: {
      access_token: "IaMaGoOdDoGpLeAsElEtMeIn",
      token_type: "Bearer",
      expiry_date: 1585600265000,
      refresh_token: "jwt-placeholder",
    },
    certificateExpiry: null,
    refreshTokenPromises: {},
    eagerRefreshThresholdMillis: 300000,
    email: "mighty_huntress@dogs.com",
    key: "DoGsArEgReAtSoMeSeCrEtStUfFhErE",
    scopes,
    gtoken: {
      token: "IaMaGoOdDoGpLeAsElEtMeIn",
      expiresAt: 1585600265000,
      rawToken: {
        access_token: "IaMaGoOdDoGpLeAsElEtMeIn",
        expires_in: 3599,
        token_type: "Bearer",
      },
      tokenExpires: null,
      key: "DoGsArEgReAtSoMeSeCrEtStUfFhErE",
      iss: "mighty_huntress@dogs.com",
      scope:
        "https://www.googleapis.com/auth/iam https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/devstorage.full_control",
    },
  },
  _cachedProjectId: "o-u-t-s-i-d-e",
  scopes,
};

const storage = {
  baseUrl: "https://www.googleapis.com/storage/v1",
  globalInterceptors: [],
  interceptors: [],
  packageJson: "<irrelevant and large - removed from fixture>",
  projectId: "o-u-t-s-i-d-e",
  projectIdRequired: false,
  authClient,
  acl: aclRoles,
};

const bucket = {
  domain: null,
  _events: {},
  _eventsCount: 0,
  metadata: {},
  baseUrl: "/b",
  parent: storage,
  id: "squirrel-chasing",
  methods: {
    create: true,
  },
  interceptors: [],
  name: "squirrel-chasing",
  storage,
  acl: aclWithDefault,
  iam: {
    resourceId_: "buckets/[object Promise]",
  },
};

export const squirrelStatsGCSFileObj = {
  domain: null,
  _events: {},
  _eventsCount: 0,
  metadata: {
    kind: "storage#object",
    id: "squirrel-chasing/captured-squirrels/march-2020-stats.csv/12312012",
    selfLink:
      "https://www.googleapis.com/storage/v1/b/squirrel-chasing/o/captured-squirrels%2Fmarch-2020-stats.csv",
    mediaLink:
      "https://www.googleapis.com/download/storage/v1/b/squirrel-chasing/o/captured-squirrels%2Fmarch-2020-stats.csv?generation=12312012&alt=media",
    name: "captured-squirrels/march-2020-stats.csv",
    bucket: "squirrel-chasing",
    generation: "12312012",
    metageneration: "1",
    contentType: "text/csv",
    storageClass: "STANDARD",
    size: "112112",
    md5Hash: "DOX0leRinotMTM7EGGXpjQ==",
    crc32c: "fVcyCg==",
    etag: "CI/UrJz0wugCEAE=",
    timeCreated: "2020-03-30T19:14:44.694Z",
    updated: "2020-03-30T19:14:44.694Z",
    timeStorageClassUpdated: "2020-03-30T19:14:44.694Z",
  },
  baseUrl: "/o",
  parent: bucket,
  id: "captured-squirrels%2Fmarch-2020-stats.csv",
  methods: {},
  interceptors: [],
  bucket,
  storage,
  name: "captured-squirrels/march-2020-stats.csv",
  acl,
};

export const squirrelSimulatorGCSFileObj = {
  domain: null,
  _events: {},
  _eventsCount: 0,
  metadata: {
    kind: "storage#object",
    id: "squirrel-chasing/squirrel-simulator/bundle.js/11212012",
    selfLink:
      "https://www.googleapis.com/storage/v1/b/squirrel-chasing/o/squirrel-simulator%2Fbundle.js",
    mediaLink:
      "https://www.googleapis.com/download/storage/v1/b/squirrel-chasing/o/squirrel-simulator%2Fbundle.js?generation=11212012&alt=media",
    name: "squirrel-simulator/bundle.js",
    bucket: "squirrel-chasing",
    generation: "11212012",
    metageneration: "1",
    contentType: "application/javascript",
    storageClass: "STANDARD",
    size: "123112",
    md5Hash: "DOX0leRinotMTM7EGGXpjQ==",
    crc32c: "fVcyCg==",
    etag: "CI/UrJz0wugCEAE=",
    timeCreated: "2020-03-30T19:14:44.694Z",
    updated: "2020-03-30T19:14:44.694Z",
    timeStorageClassUpdated: "2020-03-30T19:14:44.694Z",
  },
  baseUrl: "/o",
  parent: bucket,
  id: "squirrel-simulator%2Fbundle.js",
  methods: {},
  interceptors: [],
  bucket,
  storage,
  name: "squirrel-simulator/bundle.js",
  acl,
};
