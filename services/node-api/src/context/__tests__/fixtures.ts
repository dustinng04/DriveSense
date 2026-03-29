/**
 * Test fixtures for context detector
 * 
 * Contains sample URLs and expected detection results for testing
 */

export const testUrls = {
  googleDrive: {
    folder: [
      {
        url: "https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j",
        expected: {
          platform: "google_drive",
          contextType: "folder",
          resourceId: "1a2b3c4d5e6f7g8h9i0j",
        },
      },
      {
        url: "https://drive.google.com/drive/u/0/folders/abc123XYZ-_",
        expected: {
          platform: "google_drive",
          contextType: "folder",
          resourceId: "abc123XYZ-_",
        },
      },
    ],
    file: [
      {
        url: "https://drive.google.com/file/d/1BxYz2CvDw3Ex4Fy5Gz6Hw/view",
        expected: {
          platform: "google_drive",
          contextType: "file",
          resourceId: "1BxYz2CvDw3Ex4Fy5Gz6Hw",
        },
      },
      {
        url: "https://drive.google.com/file/d/abc-123_XYZ/view?usp=sharing",
        expected: {
          platform: "google_drive",
          contextType: "file",
          resourceId: "abc-123_XYZ",
        },
      },
    ],
    docs: [
      {
        url: "https://docs.google.com/document/d/1a2b3c4d5e6f/edit",
        expected: {
          platform: "google_drive",
          contextType: "file",
          resourceId: "1a2b3c4d5e6f",
        },
      },
      {
        url: "https://docs.google.com/spreadsheets/d/xyz789ABC/edit#gid=0",
        expected: {
          platform: "google_drive",
          contextType: "file",
          resourceId: "xyz789ABC",
        },
      },
      {
        url: "https://docs.google.com/presentation/d/slides123/edit",
        expected: {
          platform: "google_drive",
          contextType: "file",
          resourceId: "slides123",
        },
      },
      {
        url: "https://docs.google.com/forms/d/form456/edit",
        expected: {
          platform: "google_drive",
          contextType: "file",
          resourceId: "form456",
        },
      },
    ],
  },
  notion: {
    page: [
      {
        url: "https://www.notion.so/My-Page-Title-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        expected: {
          platform: "notion",
          contextType: "page",
          resourceId: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        },
      },
      {
        url: "https://notion.so/workspace/Page-abc123def456ab789cd012ef345ab678",
        expected: {
          platform: "notion",
          contextType: "page",
          resourceId: "abc123def456ab789cd012ef345ab678",
        },
      },
      {
        url: "https://notion.so/1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        expected: {
          platform: "notion",
          contextType: "page",
          resourceId: "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
        },
      },
    ],
  },
  unknown: [
    {
      url: "https://example.com/some/path",
      expected: {
        platform: "unknown",
        contextType: "unknown",
        resourceId: null,
      },
    },
    {
      url: "https://github.com/user/repo",
      expected: {
        platform: "unknown",
        contextType: "unknown",
        resourceId: null,
      },
    },
  ],
};

export const testMetadata = {
  basic: {
    title: "Test Document",
    path: "/Shared/Projects/Q1",
  },
  minimal: {
    title: "Untitled",
  },
  empty: {},
};
