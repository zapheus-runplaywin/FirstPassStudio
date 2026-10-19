{
  "targets": [{
    "target_name": "decklink",
    "sources": ["decklink.cpp"],
    "conditions": [
      ["OS=='mac'", {
        "sources": ["sdk/DeckLinkAPIDispatch.cpp"],
        "include_dirs": ["sdk"],
        "link_settings": { "libraries": ["-framework CoreFoundation"] },
        "xcode_settings": {
          "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
          "MACOSX_DEPLOYMENT_TARGET": "12.0",
          "OTHER_CPLUSPLUSFLAGS": ["-Wno-deprecated-declarations"]
        }
      }],
      ["OS!='mac'", {
        "cflags_cc": ["-std=c++17"],
        "include_dirs": ["<!(node -p \"process.env.DECKLINK_SDK || 'sdk'\")"],
        "sources": ["<!(node -p \"(process.env.DECKLINK_SDK || 'sdk') + '/DeckLinkAPIDispatch.cpp'\")"],
        "libraries": ["-ldl"]
      }]
    ]
  }]
}
