{
  "targets": [{
    "target_name": "ndi",
    "sources": ["ndi.cpp"],
    "include_dirs": ["sdk"],
    "conditions": [
      ["OS=='mac'", {
        "xcode_settings": {
          "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
          "MACOSX_DEPLOYMENT_TARGET": "12.0"
        }
      }],
      ["OS!='mac'", {
        "cflags_cc": ["-std=c++17"],
        "libraries": ["-ldl", "-lpthread"]
      }]
    ]
  }]
}
