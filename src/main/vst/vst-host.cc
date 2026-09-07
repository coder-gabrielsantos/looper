#include <napi.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cwctype>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

// The VST2 SDK is no longer distributed by Steinberg. These declarations mirror
// the public ABI closely enough to host legacy VST2 effects without shipping it.

#ifndef VSTCALLBACK
#ifdef _WIN32
#define VSTCALLBACK __cdecl
#else
#define VSTCALLBACK
#endif
#endif

using VstInt32 = int32_t;
using VstIntPtr = intptr_t;

struct AEffect;

using AudioMasterCallback = VstIntPtr(VSTCALLBACK*)(
    AEffect*, VstInt32, VstInt32, VstIntPtr, void*, float);
using AEffectDispatcherProc = VstIntPtr(VSTCALLBACK*)(
    AEffect*, VstInt32, VstInt32, VstIntPtr, void*, float);
using AEffectProcessProc = void(VSTCALLBACK*)(AEffect*, float**, float**, VstInt32);
using AEffectSetParameterProc = void(VSTCALLBACK*)(AEffect*, VstInt32, float);
using AEffectGetParameterProc = float(VSTCALLBACK*)(AEffect*, VstInt32);

// Field order and sizes must exactly match the VST2 ABI, especially on x64.
struct AEffect {
    VstInt32 magic;
    AEffectDispatcherProc dispatcher;
    AEffectProcessProc process;
    AEffectSetParameterProc setParameter;
    AEffectGetParameterProc getParameter;
    VstInt32 numPrograms;
    VstInt32 numParams;
    VstInt32 numInputs;
    VstInt32 numOutputs;
    VstInt32 flags;
    void* resvd1;
    void* resvd2;
    VstInt32 initialDelay;
    VstInt32 realQualities;
    VstInt32 offQualities;
    float ioRatio;
    void* object;
    void* user;
    VstInt32 uniqueID;
    VstInt32 version;
    AEffectProcessProc processReplacing;
    AEffectProcessProc processDoubleReplacing;
    char future[56];
};

struct ERect {
    int16_t top;
    int16_t left;
    int16_t bottom;
    int16_t right;
};

struct VstTimeInfo {
    double samplePos;
    double sampleRate;
    double nanoSeconds;
    double ppqPos;
    double tempo;
    double barStartPos;
    double cycleStartPos;
    double cycleEndPos;
    VstInt32 timeSigNumerator;
    VstInt32 timeSigDenominator;
    VstInt32 smpteOffset;
    VstInt32 smpteFrameRate;
    VstInt32 samplesToNextClock;
    VstInt32 flags;
};

constexpr VstInt32 kVstVersion = 2400;
constexpr VstInt32 kEffectMagic = 0x56737450;  // 'VstP'
constexpr VstInt32 kEffectHasEditor = 1 << 0;
constexpr VstInt32 kVstTempoValid = 1 << 10;
constexpr VstInt32 kVstTimeSigValid = 1 << 13;

enum AudioMasterOpcodes : VstInt32 {
    audioMasterAutomate = 0,
    audioMasterVersion = 1,
    audioMasterCurrentId = 2,
    audioMasterIdle = 3,
    audioMasterPinConnected = 4,
    audioMasterWantMidi = 6,
    audioMasterGetTime = 7,
    audioMasterProcessEvents = 8,
    audioMasterTempoAt = 10,
    audioMasterIOChanged = 13,
    audioMasterNeedIdle = 14,
    audioMasterSizeWindow = 15,
    audioMasterGetSampleRate = 16,
    audioMasterGetBlockSize = 17,
    audioMasterGetInputLatency = 18,
    audioMasterGetOutputLatency = 19,
    audioMasterWillReplaceOrAccumulate = 22,
    audioMasterGetCurrentProcessLevel = 23,
    audioMasterGetAutomationState = 24,
    audioMasterGetVendorString = 32,
    audioMasterGetProductString = 33,
    audioMasterGetVendorVersion = 34,
    audioMasterCanDo = 37,
    audioMasterGetLanguage = 38,
    audioMasterGetDirectory = 41,
    audioMasterUpdateDisplay = 42,
    audioMasterBeginEdit = 43,
    audioMasterEndEdit = 44
};

enum EffectOpcodes : VstInt32 {
    effOpen = 0,
    effClose = 1,
    effSetProgram = 2,
    effGetProgram = 3,
    effSetProgramName = 4,
    effGetProgramName = 5,
    effGetParamLabel = 6,
    effGetParamDisplay = 7,
    effGetParamName = 8,
    effSetSampleRate = 10,
    effSetBlockSize = 11,
    effMainsChanged = 12,
    effEditGetRect = 13,
    effEditOpen = 14,
    effEditClose = 15,
    effEditIdle = 19,
    effGetEffectName = 45,
    effGetVendorString = 47,
    effGetProductString = 48,
    effGetVendorVersion = 49,
    effCanDo = 51,
    effStartProcess = 71,
    effStopProcess = 72
};

#ifdef _WIN32
using VstEntryFunc = AEffect*(VSTCALLBACK*)(AudioMasterCallback);

struct PluginInstance {
    AEffect* effect = nullptr;
    HMODULE module = nullptr;
    std::wstring path;
    std::wstring displayName;
    VstInt32 sampleRate = 48000;
    VstInt32 blockSize = 2048;
    double tempo = 120.0;
    bool opened = false;
    bool mainsOn = false;
    bool processStarted = false;
    bool processingHealthy = true;
    HWND editorWindow = nullptr;
    bool editorOpen = false;
    VstTimeInfo timeInfo = {};
};

static std::map<int, std::unique_ptr<PluginInstance>> g_plugins;
static int g_nextHandle = 1;
static constexpr wchar_t kEditorWindowClass[] = L"LooperVst2EditorHost";

static PluginInstance* FindPlugin(AEffect* effect) {
    for (auto& entry : g_plugins) {
        if (entry.second->effect == effect) return entry.second.get();
    }
    return nullptr;
}

static bool SafeDispatch(
    AEffect* effect,
    VstInt32 opCode,
    VstInt32 index = 0,
    VstIntPtr value = 0,
    void* ptr = nullptr,
    float opt = 0,
    VstIntPtr* result = nullptr) {
    if (!effect || !effect->dispatcher) return false;

    __try {
        const VstIntPtr dispatchResult = effect->dispatcher(effect, opCode, index, value, ptr, opt);
        if (result) *result = dispatchResult;
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        if (result) *result = 0;
        return false;
    }
}

static bool SafeEntry(VstEntryFunc entry, AudioMasterCallback callback, AEffect** effect) {
    if (!entry || !effect) return false;
    __try {
        *effect = entry(callback);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        *effect = nullptr;
        return false;
    }
}

static bool SafeProcess(AEffect* effect, float** inputs, float** outputs, VstInt32 frameCount) {
    if (!effect) return false;
    __try {
        if (effect->processReplacing) {
            effect->processReplacing(effect, inputs, outputs, frameCount);
            return true;
        }
        if (effect->process) {
            effect->process(effect, inputs, outputs, frameCount);
            return true;
        }
        return false;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

static bool SafeSetParameter(AEffect* effect, VstInt32 index, float value) {
    if (!effect || !effect->setParameter) return false;
    __try {
        effect->setParameter(effect, index, value);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}

static bool SafeGetParameter(AEffect* effect, VstInt32 index, float* value) {
    if (!effect || !effect->getParameter || !value) return false;
    __try {
        *value = effect->getParameter(effect, index);
        return true;
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        *value = 0;
        return false;
    }
}

static std::wstring Utf8ToWide(const std::string& value) {
    if (value.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    if (size <= 0) return {};
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}

static std::string WideToUtf8(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string result(static_cast<size_t>(size), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
    return result;
}

static std::wstring FileStem(const std::wstring& path) {
    const size_t slash = path.find_last_of(L"\\/");
    const size_t start = slash == std::wstring::npos ? 0 : slash + 1;
    const size_t dot = path.find_last_of(L'.');
    const size_t end = dot == std::wstring::npos || dot < start ? path.size() : dot;
    return path.substr(start, end - start);
}

static std::wstring Lowercase(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
        return static_cast<wchar_t>(std::towlower(ch));
    });
    return value;
}

static bool EndsWithDll(const std::wstring& path) {
    const std::wstring lower = Lowercase(path);
    return lower.size() >= 4 && lower.compare(lower.size() - 4, 4, L".dll") == 0;
}

static void ScanDirectory(
    const std::wstring& directory,
    std::vector<std::wstring>& plugins,
    std::set<std::wstring>& seen) {
    WIN32_FIND_DATAW findData = {};
    const std::wstring pattern = directory + L"\\*";
    HANDLE find = FindFirstFileW(pattern.c_str(), &findData);
    if (find == INVALID_HANDLE_VALUE) return;

    do {
        const std::wstring name = findData.cFileName;
        if (name == L"." || name == L"..") continue;
        const std::wstring fullPath = directory + L"\\" + name;

        if ((findData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) {
            if ((findData.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0) {
                ScanDirectory(fullPath, plugins, seen);
            }
            continue;
        }

        if (!EndsWithDll(fullPath)) continue;
        const std::wstring key = Lowercase(fullPath);
        if (seen.insert(key).second) plugins.push_back(fullPath);
    } while (FindNextFileW(find, &findData));

    FindClose(find);
}

static void ResizeEditorHost(PluginInstance* instance, int clientWidth, int clientHeight) {
    if (!instance || !instance->editorWindow || clientWidth <= 0 || clientHeight <= 0) return;
    const int width = std::clamp(clientWidth, 160, 4096);
    const int height = std::clamp(clientHeight, 100, 2160);
    RECT windowRect = {0, 0, width, height};
    const DWORD style = static_cast<DWORD>(GetWindowLongPtrW(instance->editorWindow, GWL_STYLE));
    const DWORD exStyle = static_cast<DWORD>(GetWindowLongPtrW(instance->editorWindow, GWL_EXSTYLE));
    AdjustWindowRectEx(&windowRect, style, FALSE, exStyle);
    SetWindowPos(
        instance->editorWindow,
        nullptr,
        0,
        0,
        windowRect.right - windowRect.left,
        windowRect.bottom - windowRect.top,
        SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
}

static VstIntPtr VSTCALLBACK AudioMaster(
    AEffect* effect,
    VstInt32 opCode,
    VstInt32 index,
    VstIntPtr value,
    void* ptr,
    float) {
    PluginInstance* instance = FindPlugin(effect);

    __try {
        switch (opCode) {
            case audioMasterVersion:
                return kVstVersion;
            case audioMasterCurrentId:
            case audioMasterAutomate:
            case audioMasterIdle:
            case audioMasterWantMidi:
            case audioMasterProcessEvents:
            case audioMasterIOChanged:
            case audioMasterNeedIdle:
            case audioMasterUpdateDisplay:
            case audioMasterBeginEdit:
            case audioMasterEndEdit:
                return 0;
            case audioMasterPinConnected:
                return 0;  // zero means connected in VST2.
            case audioMasterGetTime: {
                if (!instance) return 0;
                auto& time = instance->timeInfo;
                time.sampleRate = instance->sampleRate;
                time.tempo = instance->tempo;
                time.ppqPos = time.samplePos / time.sampleRate * time.tempo / 60.0;
                time.barStartPos = std::floor(time.ppqPos / 4.0) * 4.0;
                time.timeSigNumerator = 4;
                time.timeSigDenominator = 4;
                time.flags = kVstTempoValid | kVstTimeSigValid;
                return reinterpret_cast<VstIntPtr>(&time);
            }
            case audioMasterTempoAt:
                return static_cast<VstIntPtr>((instance ? instance->tempo : 120.0) * 10000.0);
            case audioMasterSizeWindow:
                ResizeEditorHost(instance, index, static_cast<int>(value));
                return 1;
            case audioMasterGetSampleRate:
                return instance ? instance->sampleRate : 48000;
            case audioMasterGetBlockSize:
                return instance ? instance->blockSize : 2048;
            case audioMasterGetInputLatency:
            case audioMasterGetOutputLatency:
            case audioMasterGetCurrentProcessLevel:
            case audioMasterGetAutomationState:
            case audioMasterWillReplaceOrAccumulate:
                return 0;
            case audioMasterGetVendorString:
                if (ptr) {
                    std::strncpy(static_cast<char*>(ptr), "Looper", 63);
                    static_cast<char*>(ptr)[63] = '\0';
                }
                return 1;
            case audioMasterGetProductString:
                if (ptr) {
                    std::strncpy(static_cast<char*>(ptr), "Looper", 63);
                    static_cast<char*>(ptr)[63] = '\0';
                }
                return 1;
            case audioMasterGetVendorVersion:
                return 1000;
            case audioMasterCanDo:
                if (!ptr) return 0;
                if (std::strcmp(static_cast<const char*>(ptr), "sizeWindow") == 0) return 1;
                if (std::strcmp(static_cast<const char*>(ptr), "startStopProcess") == 0) return 1;
                return 0;
            case audioMasterGetLanguage:
                return 1;  // English
            case audioMasterGetDirectory:
                return 0;
            default:
                return 0;
        }
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return 0;
    }
}

static void CloseEditorWindow(PluginInstance* instance) {
    if (!instance) return;
    HWND window = instance->editorWindow;
    if (window) KillTimer(window, 1);
    if (instance->editorOpen) {
        SafeDispatch(instance->effect, effEditClose);
        instance->editorOpen = false;
    }
    instance->editorWindow = nullptr;
    if (window && IsWindow(window)) DestroyWindow(window);
}

static LRESULT CALLBACK EditorWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    PluginInstance* instance = reinterpret_cast<PluginInstance*>(
        GetWindowLongPtrW(window, GWLP_USERDATA));

    if (message == WM_NCCREATE) {
        auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        instance = static_cast<PluginInstance*>(create->lpCreateParams);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(instance));
    }

    switch (message) {
        case WM_TIMER:
            if (instance && instance->editorOpen) SafeDispatch(instance->effect, effEditIdle);
            return 0;
        case WM_CLOSE:
            CloseEditorWindow(instance);
            return 0;
        case WM_DESTROY:
            if (instance && instance->editorOpen) {
                KillTimer(window, 1);
                SafeDispatch(instance->effect, effEditClose);
                instance->editorOpen = false;
                instance->editorWindow = nullptr;
            }
            return 0;
        case WM_NCDESTROY:
            if (instance) {
                instance->editorWindow = nullptr;
                instance->editorOpen = false;
            }
            SetWindowLongPtrW(window, GWLP_USERDATA, 0);
            return DefWindowProcW(window, message, wParam, lParam);
        default:
            return DefWindowProcW(window, message, wParam, lParam);
    }
}

static bool EnsureEditorWindowClass() {
    static bool attempted = false;
    static bool registered = false;
    if (attempted) return registered;
    attempted = true;

    WNDCLASSEXW windowClass = {};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.lpfnWndProc = EditorWindowProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.hCursor = LoadCursorW(nullptr, reinterpret_cast<LPCWSTR>(IDC_ARROW));
    windowClass.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    windowClass.lpszClassName = kEditorWindowClass;
    registered = RegisterClassExW(&windowClass) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    return registered;
}

static void ShutDownPlugin(PluginInstance* instance) {
    if (!instance) return;
    CloseEditorWindow(instance);
    if (instance->processStarted) {
        SafeDispatch(instance->effect, effStopProcess);
        instance->processStarted = false;
    }
    if (instance->mainsOn) {
        SafeDispatch(instance->effect, effMainsChanged, 0, 0);
        instance->mainsOn = false;
    }
    if (instance->opened) {
        SafeDispatch(instance->effect, effClose);
        instance->opened = false;
    }
}
#endif

static Napi::Value ScanPlugins(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Expected array of paths").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Array result = Napi::Array::New(env);
#ifdef _WIN32
    std::vector<std::wstring> pluginPaths;
    std::set<std::wstring> seen;
    Napi::Array paths = info[0].As<Napi::Array>();
    for (uint32_t index = 0; index < paths.Length(); ++index) {
        Napi::Value pathValue = paths.Get(index);
        if (!pathValue.IsString()) continue;
        const std::wstring path = Utf8ToWide(pathValue.As<Napi::String>().Utf8Value());
        if (!path.empty()) ScanDirectory(path, pluginPaths, seen);
    }

    uint32_t resultIndex = 0;
    for (const auto& path : pluginPaths) {
        Napi::Object plugin = Napi::Object::New(env);
        plugin.Set("name", WideToUtf8(FileStem(path)));
        plugin.Set("path", WideToUtf8(path));
        plugin.Set("format", "VST2");
        plugin.Set("vendor", "");
        result[resultIndex++] = plugin;
    }
#endif
    return result;
}

static Napi::Value LoadPlugin(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected (path, sampleRate, blockSize)").ThrowAsJavaScriptException();
        return env.Null();
    }

#ifndef _WIN32
    Napi::Error::New(env, "The VST2 host is currently available only on Windows").ThrowAsJavaScriptException();
    return env.Null();
#else
    const std::wstring path = Utf8ToWide(info[0].As<Napi::String>().Utf8Value());
    const VstInt32 sampleRate = std::clamp(info[1].As<Napi::Number>().Int32Value(), 8000, 384000);
    const VstInt32 blockSize = std::clamp(info[2].As<Napi::Number>().Int32Value(), 16, 16384);

    HMODULE module = LoadLibraryW(path.c_str());
    if (!module) {
        Napi::Error::New(env, "Failed to load the VST2 DLL").ThrowAsJavaScriptException();
        return env.Null();
    }

    auto entry = reinterpret_cast<VstEntryFunc>(GetProcAddress(module, "VSTPluginMain"));
    if (!entry) entry = reinterpret_cast<VstEntryFunc>(GetProcAddress(module, "main"));
    if (!entry) {
        FreeLibrary(module);
        Napi::Error::New(env, "The selected DLL is not a VST2 plugin").ThrowAsJavaScriptException();
        return env.Null();
    }

    AEffect* effect = nullptr;
    if (!SafeEntry(entry, AudioMaster, &effect) || !effect || effect->magic != kEffectMagic ||
        !effect->dispatcher || effect->numInputs < 0 || effect->numInputs > 64 ||
        effect->numOutputs < 0 || effect->numOutputs > 64 || effect->numParams < 0 ||
        effect->numParams > 100000) {
        FreeLibrary(module);
        Napi::Error::New(env, "The VST2 plugin returned an invalid instance").ThrowAsJavaScriptException();
        return env.Null();
    }

    auto instance = std::make_unique<PluginInstance>();
    instance->effect = effect;
    instance->module = module;
    instance->path = path;
    instance->displayName = FileStem(path);
    instance->sampleRate = sampleRate;
    instance->blockSize = blockSize;
    instance->timeInfo.sampleRate = sampleRate;
    instance->timeInfo.tempo = 120.0;
    instance->timeInfo.timeSigNumerator = 4;
    instance->timeInfo.timeSigDenominator = 4;

    const int handle = g_nextHandle++;
    PluginInstance* rawInstance = instance.get();
    g_plugins[handle] = std::move(instance);

    if (!SafeDispatch(effect, effOpen)) {
        g_plugins.erase(handle);
        FreeLibrary(module);
        Napi::Error::New(env, "The VST2 plugin crashed while opening").ThrowAsJavaScriptException();
        return env.Null();
    }
    rawInstance->opened = true;

    char productName[256] = {};
    SafeDispatch(effect, effGetProductString, 0, 0, productName);
    if (productName[0] == '\0') SafeDispatch(effect, effGetEffectName, 0, 0, productName);
    if (productName[0] != '\0') rawInstance->displayName = Utf8ToWide(productName);

    if (!SafeDispatch(effect, effSetSampleRate, 0, 0, nullptr, static_cast<float>(sampleRate)) ||
        !SafeDispatch(effect, effSetBlockSize, 0, blockSize) ||
        !SafeDispatch(effect, effMainsChanged, 0, 1)) {
        ShutDownPlugin(rawInstance);
        g_plugins.erase(handle);
        FreeLibrary(module);
        Napi::Error::New(env, "The VST2 plugin failed during audio initialization").ThrowAsJavaScriptException();
        return env.Null();
    }
    rawInstance->mainsOn = true;
    rawInstance->processStarted = SafeDispatch(effect, effStartProcess);

    Napi::Object result = Napi::Object::New(env);
    result.Set("handle", handle);
    result.Set("numInputs", effect->numInputs);
    result.Set("numOutputs", effect->numOutputs);
    result.Set("numParams", effect->numParams);
    result.Set("initialDelay", effect->initialDelay);
    result.Set("hasEditor", (effect->flags & kEffectHasEditor) != 0);
    result.Set("name", WideToUtf8(rawInstance->displayName));
    return result;
#endif
}

static Napi::Value UnloadPlugin(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) return env.Undefined();
#ifdef _WIN32
    const int handle = info[0].As<Napi::Number>().Int32Value();
    auto iterator = g_plugins.find(handle);
    if (iterator != g_plugins.end()) {
        PluginInstance* instance = iterator->second.get();
        ShutDownPlugin(instance);
        HMODULE module = instance->module;
        g_plugins.erase(iterator);
        if (module) FreeLibrary(module);
    }
#endif
    return env.Undefined();
}

static Napi::Value ProcessAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsTypedArray() || !info[2].IsTypedArray()) {
        Napi::TypeError::New(env, "Expected (handle, inputBuffer, outputBuffer)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Float32Array input = info[1].As<Napi::Float32Array>();
    Napi::Float32Array output = info[2].As<Napi::Float32Array>();
    const size_t frameCount = std::min(input.ElementLength(), output.ElementLength());
    std::copy(input.Data(), input.Data() + frameCount, output.Data());

#ifdef _WIN32
    const int handle = info[0].As<Napi::Number>().Int32Value();
    auto iterator = g_plugins.find(handle);
    if (iterator == g_plugins.end() || frameCount == 0) return env.Undefined();

    PluginInstance* instance = iterator->second.get();
    AEffect* effect = instance->effect;
    if (!instance->mainsOn || !instance->processingHealthy || effect->numOutputs <= 0) {
        return env.Undefined();
    }

    const size_t inputCount = static_cast<size_t>(std::max<VstInt32>(1, effect->numInputs));
    const size_t outputCount = static_cast<size_t>(std::max<VstInt32>(1, effect->numOutputs));
    std::vector<std::vector<float>> inputChannels(inputCount, std::vector<float>(frameCount));
    std::vector<std::vector<float>> outputChannels(outputCount, std::vector<float>(frameCount, 0));
    std::vector<float*> inputPointers(inputCount);
    std::vector<float*> outputPointers(outputCount);

    for (size_t channel = 0; channel < inputCount; ++channel) {
        std::copy(input.Data(), input.Data() + frameCount, inputChannels[channel].begin());
        inputPointers[channel] = inputChannels[channel].data();
    }
    for (size_t channel = 0; channel < outputCount; ++channel) {
        outputPointers[channel] = outputChannels[channel].data();
    }

    if (!SafeProcess(effect, inputPointers.data(), outputPointers.data(), static_cast<VstInt32>(frameCount))) {
        instance->processingHealthy = false;
        return env.Undefined();
    }

    const size_t mixedChannels = std::min<size_t>(2, outputCount);
    for (size_t frame = 0; frame < frameCount; ++frame) {
        float mixed = 0;
        for (size_t channel = 0; channel < mixedChannels; ++channel) {
            mixed += outputChannels[channel][frame];
        }
        output[frame] = mixed / static_cast<float>(mixedChannels);
    }
    instance->timeInfo.samplePos += static_cast<double>(frameCount);
#endif
    return env.Undefined();
}

static Napi::Value GetParameterCount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    if (info.Length() >= 1 && info[0].IsNumber()) {
        const int handle = info[0].As<Napi::Number>().Int32Value();
        auto iterator = g_plugins.find(handle);
        if (iterator != g_plugins.end()) return Napi::Number::New(env, iterator->second->effect->numParams);
    }
#endif
    return Napi::Number::New(env, 0);
}

static Napi::Value SetParameter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    if (info.Length() >= 3 && info[0].IsNumber() && info[1].IsNumber() && info[2].IsNumber()) {
        const int handle = info[0].As<Napi::Number>().Int32Value();
        const VstInt32 index = info[1].As<Napi::Number>().Int32Value();
        auto iterator = g_plugins.find(handle);
        if (iterator != g_plugins.end() && index >= 0 && index < iterator->second->effect->numParams) {
            const float value = std::clamp(info[2].As<Napi::Number>().FloatValue(), 0.0f, 1.0f);
            SafeSetParameter(iterator->second->effect, index, value);
        }
    }
#endif
    return env.Undefined();
}

static Napi::Value GetParameter(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
        const int handle = info[0].As<Napi::Number>().Int32Value();
        const VstInt32 index = info[1].As<Napi::Number>().Int32Value();
        auto iterator = g_plugins.find(handle);
        if (iterator != g_plugins.end() && index >= 0 && index < iterator->second->effect->numParams) {
            float value = 0;
            SafeGetParameter(iterator->second->effect, index, &value);
            return Napi::Number::New(env, value);
        }
    }
#endif
    return Napi::Number::New(env, 0);
}

static Napi::Value SetTempo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
        const int handle = info[0].As<Napi::Number>().Int32Value();
        auto iterator = g_plugins.find(handle);
        if (iterator != g_plugins.end()) {
            iterator->second->tempo = std::clamp(info[1].As<Napi::Number>().DoubleValue(), 20.0, 400.0);
            iterator->second->timeInfo.tempo = iterator->second->tempo;
        }
    }
#endif
    return env.Undefined();
}

static Napi::Value OpenEditor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    result.Set("opened", false);
    result.Set("hasEditor", false);
    result.Set("width", 0);
    result.Set("height", 0);

#ifdef _WIN32
    if (info.Length() < 1 || !info[0].IsNumber()) return result;
    const int handle = info[0].As<Napi::Number>().Int32Value();
    auto iterator = g_plugins.find(handle);
    if (iterator == g_plugins.end()) return result;

    PluginInstance* instance = iterator->second.get();
    const bool hasEditor = (instance->effect->flags & kEffectHasEditor) != 0;
    result.Set("hasEditor", hasEditor);
    if (!hasEditor) return result;

    if (instance->editorWindow && IsWindow(instance->editorWindow)) {
        ShowWindow(instance->editorWindow, SW_RESTORE);
        SetForegroundWindow(instance->editorWindow);
        RECT client = {};
        GetClientRect(instance->editorWindow, &client);
        result.Set("opened", true);
        result.Set("width", client.right - client.left);
        result.Set("height", client.bottom - client.top);
        return result;
    }

    HWND owner = nullptr;
    if (info.Length() >= 2 && info[1].IsBuffer()) {
        Napi::Buffer<uint8_t> ownerBuffer = info[1].As<Napi::Buffer<uint8_t>>();
        uintptr_t ownerValue = 0;
        std::memcpy(&ownerValue, ownerBuffer.Data(), std::min(ownerBuffer.Length(), sizeof(ownerValue)));
        owner = reinterpret_cast<HWND>(ownerValue);
    }

    if (!EnsureEditorWindowClass()) {
        Napi::Error::New(env, "Could not register the VST editor window").ThrowAsJavaScriptException();
        return env.Null();
    }

    const std::wstring title = L"Master FX - " + instance->displayName;
    HWND window = CreateWindowExW(
        WS_EX_TOOLWINDOW,
        kEditorWindowClass,
        title.c_str(),
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        640,
        480,
        owner,
        nullptr,
        GetModuleHandleW(nullptr),
        instance);
    if (!window) {
        Napi::Error::New(env, "Could not create the VST editor window").ThrowAsJavaScriptException();
        return env.Null();
    }

    instance->editorWindow = window;
    if (!SafeDispatch(instance->effect, effEditOpen, 0, 0, window)) {
        CloseEditorWindow(instance);
        Napi::Error::New(env, "The VST2 plugin crashed while opening its interface").ThrowAsJavaScriptException();
        return env.Null();
    }
    instance->editorOpen = true;

    int width = 640;
    int height = 480;
    ERect* editorRect = nullptr;
    if (SafeDispatch(instance->effect, effEditGetRect, 0, 0, &editorRect) && editorRect) {
        const int requestedWidth = editorRect->right - editorRect->left;
        const int requestedHeight = editorRect->bottom - editorRect->top;
        if (requestedWidth > 0 && requestedHeight > 0) {
            width = requestedWidth;
            height = requestedHeight;
        }
    }
    ResizeEditorHost(instance, width, height);

    RECT hostRect = {};
    RECT ownerRect = {};
    GetWindowRect(window, &hostRect);
    if (owner && GetWindowRect(owner, &ownerRect)) {
        const int hostWidth = hostRect.right - hostRect.left;
        const int hostHeight = hostRect.bottom - hostRect.top;
        const int x = ownerRect.left + ((ownerRect.right - ownerRect.left) - hostWidth) / 2;
        const int y = ownerRect.top + ((ownerRect.bottom - ownerRect.top) - hostHeight) / 2;
        SetWindowPos(window, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    SetTimer(window, 1, 30, nullptr);
    ShowWindow(window, SW_SHOW);
    UpdateWindow(window);
    SetForegroundWindow(window);
    result.Set("opened", true);
    result.Set("width", width);
    result.Set("height", height);
#endif
    return result;
}

static Napi::Value CloseEditor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
#ifdef _WIN32
    if (info.Length() >= 1 && info[0].IsNumber()) {
        const int handle = info[0].As<Napi::Number>().Int32Value();
        auto iterator = g_plugins.find(handle);
        if (iterator != g_plugins.end()) CloseEditorWindow(iterator->second.get());
    }
#endif
    return env.Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("scanPlugins", Napi::Function::New(env, ScanPlugins));
    exports.Set("loadPlugin", Napi::Function::New(env, LoadPlugin));
    exports.Set("unloadPlugin", Napi::Function::New(env, UnloadPlugin));
    exports.Set("processAudio", Napi::Function::New(env, ProcessAudio));
    exports.Set("getParameterCount", Napi::Function::New(env, GetParameterCount));
    exports.Set("setParameter", Napi::Function::New(env, SetParameter));
    exports.Set("getParameter", Napi::Function::New(env, GetParameter));
    exports.Set("setTempo", Napi::Function::New(env, SetTempo));
    exports.Set("openEditor", Napi::Function::New(env, OpenEditor));
    exports.Set("closeEditor", Napi::Function::New(env, CloseEditor));
    return exports;
}

NODE_API_MODULE(vst_host, Init)
