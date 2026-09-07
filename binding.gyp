{
  "targets": [
    {
      "target_name": "vst-host",
      "sources": ["src/main/vst/vst-host.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 2,
              "RuntimeTypeInfo": "true",
              "AdditionalOptions": ["/std:c++17"]
            }
          },
          "libraries": ["user32.lib"]
        }]
      ]
    }
  ]
}
