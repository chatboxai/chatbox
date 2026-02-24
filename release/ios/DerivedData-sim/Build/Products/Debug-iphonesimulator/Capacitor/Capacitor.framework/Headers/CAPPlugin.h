#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

@protocol CAPBridgeProtocol;
@class CAPPluginCall;

@class PluginConfig;

@interface CAPPlugin : NSObject

@property (nonatomic, weak, nullable) WKWebView *webView;
@property (nonatomic, weak, nullable) id<CAPBridgeProtocol> bridge;
@property (nonatomic, strong, nonnull) NSString *pluginId;
@property (nonatomic, strong, nonnull) NSString *pluginName;
@property (nonatomic, strong, nullable) NSMutableDictionary<NSString *, NSMutableArray<CAPPluginCall *>*> *eventListeners;
@property (nonatomic, strong, nullable) NSMutableDictionary<NSString *, NSMutableArray<id> *> *retainedEventArguments;
@property (nonatomic, assign) BOOL shouldStringifyDatesInCalls;

- (instancetype _Nonnull) initWithBridge:(id<CAPBridgeProtocol> _Nonnull) bridge pluginId:(NSString* _Nonnull) pluginId pluginName:(NSString* _Nonnull) pluginName DEPRECATED_MSG_ATTRIBUTE("This initializer is deprecated and is not suggested for use. Any data set through this init method will be overridden when it is loaded on the bridge.");
- (void)addEventListener:(NSString* _Nonnull)eventName listener:(CAPPluginCall* _Nonnull)listener;
- (void)removeEventListener:(NSString* _Nonnull)eventName listener:(CAPPluginCall* _Nonnull)listener;
- (void)notifyListeners:(NSString* _Nonnull)eventName data:(NSDictionary<NSString *, id>* _Nullable)data;
- (void)notifyListeners:(NSString* _Nonnull)eventName data:(NSDictionary<NSString *, id>* _Nullable)data retainUntilConsumed:(BOOL)retain;
- (NSArray<CAPPluginCall *>* _Nullable)getListeners:(NSString* _Nonnull)eventName;
- (BOOL)hasListeners:(NSString* _Nonnull)eventName;
- (void)addListener:(CAPPluginCall* _Nonnull)call;
- (void)removeListener:(CAPPluginCall* _Nonnull)call;
- (void)removeAllListeners:(CAPPluginCall* _Nonnull)call;
/**
 * Default implementation of the capacitor 3.0 permission pattern
 */
- (void)checkPermissions:(CAPPluginCall* _Nonnull)call;
- (void)requestPermissions:(CAPPluginCall* _Nonnull)call;
/**
 * Give the plugins a chance to take control when a URL is about to be loaded in the WebView.
 * Returning true causes the WebView to abort loading the URL.
 * Returning false causes the WebView to continue loading the URL.
 * Returning nil will defer to the default Capacitor policy
 */
- (NSNumber* _Nullable)shouldOverrideLoad:(WKNavigationAction* _Nonnull)navigationAction;

// Called after init if the plugin wants to do
// some loading so the plugin author doesn't
// need to override init()
-(void)load;
-(NSString* _Nonnull)getId;
-(BOOL)getBool:(CAPPluginCall* _Nonnull) call field:(NSString* _Nonnull)field defaultValue:(BOOL)defaultValue DEPRECATED_MSG_ATTRIBUTE("Use accessors on CAPPluginCall instead. See CAPBridgedJSTypes.h for Obj-C implementations.");
-(NSString* _Nullable)getString:(CAPPluginCall* _Nonnull)call field:(NSString* _Nonnull)field defaultValue:(NSString* _Nonnull)defaultValue DEPRECATED_MSG_ATTRIBUTE("Use accessors on CAPPluginCall instead. See CAPBridgedJSTypes.h for Obj-C implementations.");
-(id _Nullable)getConfigValue:(NSString* _Nonnull)key __deprecated_msg("use getConfig() and access config values using the methods available depending on the type.");
-(PluginConfig* _Nonnull)getConfig;
-(void)setCenteredPopover:(UIViewController* _Nonnull) vc;
-(void)setCenteredPopover:(UIViewController* _Nonnull) vc size:(CGSize) size;
-(BOOL)supportsPopover DEPRECATED_MSG_ATTRIBUTE("All iOS 13+ devices support popover");

@end
