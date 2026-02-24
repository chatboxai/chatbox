#ifndef CAPInstanceDescriptor_h
#define CAPInstanceDescriptor_h

@import UIKit;
@import Cordova;

typedef NS_ENUM(NSInteger, CAPInstanceType) {
    CAPInstanceTypeFixed NS_SWIFT_NAME(fixed),
    CAPInstanceTypeVariable NS_SWIFT_NAME(variable)
} NS_SWIFT_NAME(InstanceType);

typedef NS_OPTIONS(NSUInteger, CAPInstanceWarning) {
    CAPInstanceWarningMissingAppDir       NS_SWIFT_NAME(missingAppDir)      = 1 << 0,
    CAPInstanceWarningMissingFile         NS_SWIFT_NAME(missingFile)        = 1 << 1,
    CAPInstanceWarningInvalidFile         NS_SWIFT_NAME(invalidFile)        = 1 << 2,
    CAPInstanceWarningMissingCordovaFile  NS_SWIFT_NAME(missingCordovaFile) = 1 << 3,
    CAPInstanceWarningInvalidCordovaFile  NS_SWIFT_NAME(invalidCordovaFile) = 1 << 4
} NS_SWIFT_NAME(InstanceWarning);

typedef NS_OPTIONS(NSUInteger, CAPInstanceLoggingBehavior) {
    CAPInstanceLoggingBehaviorNone          NS_SWIFT_NAME(none)         = 1 << 0,
    CAPInstanceLoggingBehaviorDebug         NS_SWIFT_NAME(debug)        = 1 << 1,
    CAPInstanceLoggingBehaviorProduction    NS_SWIFT_NAME(production)   = 1 << 2,
} NS_SWIFT_NAME(InstanceLoggingBehavior);

extern NSString * _Nonnull const CAPInstanceDescriptorDefaultScheme NS_SWIFT_UNAVAILABLE("Use InstanceDescriptorDefaults");
extern NSString * _Nonnull const CAPInstanceDescriptorDefaultHostname NS_SWIFT_UNAVAILABLE("Use InstanceDescriptorDefaults");

NS_SWIFT_NAME(InstanceDescriptor)
@interface CAPInstanceDescriptor : NSObject
/**
 @brief A value to append to the @c User-Agent string. Ignored if @c overridenUserAgentString is set.
 @discussion Set by @c appendUserAgent in the configuration file.
 */
@property (nonatomic, copy, nullable) NSString *appendedUserAgentString;
/**
 @brief A value that will completely replace the @c User-Agent string. Overrides @c appendedUserAgentString.
 @discussion Set by @c overrideUserAgent in the configuration file.
 */
@property (nonatomic, copy, nullable) NSString *overridenUserAgentString;
/**
 @brief The background color to set on the web view where content is not visible.
 @discussion Set by @c backgroundColor in the configuration file.
 */
@property (nonatomic, retain, nullable) UIColor *backgroundColor;
/**
 @brief Hostnames to which the web view is allowed to navigate without opening an external browser.
 @discussion Set by @c allowNavigation in the configuration file.
 */
@property (nonatomic, copy, nonnull) NSArray<NSString*> *allowedNavigationHostnames;
/**
 @brief The scheme that will be used for the server URL.
 @discussion Defaults to @c capacitor. Set by @c server.iosScheme in the configuration file.
 */
@property (nonatomic, copy, nullable) NSString *urlScheme;
/**
 @brief The path to a local html page to display in case of errors.
 @discussion Defaults to nil.
 */
@property (nonatomic, copy, nullable) NSString *errorPath;
/**
 @brief The hostname that will be used for the server URL.
 @discussion Defaults to @c localhost. Set by @c server.hostname in the configuration file.
 */
@property (nonatomic, copy, nullable) NSString *urlHostname;
/**
 @brief The fully formed URL that will be used as the server URL.
 @discussion Defaults to nil, in which case the server URL will be constructed from @c urlScheme and @c urlHostname. If set, it will override the other properties. Set by @c server.url in the configuration file.
 */
@property (nonatomic, copy, nullable) NSString *serverURL;
/**
 @brief The JSON dictionary that contains the plugin-specific configuration information.
 @discussion Set by @c plugins in the configuration file.
 */
@property (nonatomic, retain, nonnull) NSDictionary *pluginConfigurations;
/**
 @brief The build configurations under which logging should be enabled.
 @discussion Defaults to @c debug. Set by @c loggingBehavior in the configuration file.
 */
@property (nonatomic, assign) CAPInstanceLoggingBehavior loggingBehavior;
/**
 @brief Whether or not the web view can scroll.
 @discussion Set by @c ios.scrollEnabled in the configuration file. Corresponds to @c isScrollEnabled on WKWebView.
 */
@property (nonatomic, assign) BOOL scrollingEnabled;
/**
 @brief Whether or not the web view can zoom.
 @discussion Set by @c zoomEnabled in the configuration file.
 */
@property (nonatomic, assign) BOOL zoomingEnabled;
/**
 @brief Whether or not the web view will preview links.
 @discussion Set by @c ios.allowsLinkPreview in the configuration file. Corresponds to @c allowsLinkPreview on WKWebView.
 */
@property (nonatomic, assign) BOOL allowLinkPreviews;
/**
 @brief Whether or not the Capacitor runtime will set itself as the @c UNUserNotificationCenter delegate.
 @discussion Defaults to @c true. Required to be @c true for notification plugins to work correctly. Set to @c false if your application will handle notifications independently.
 */
@property (nonatomic, assign) BOOL handleApplicationNotifications;
/**
 @brief Enables web debugging by setting isInspectable of  @c WKWebView to @c true on iOS 16.4 and greater
 @discussion Defaults to true in debug mode and false in production
 */
@property (nonatomic, assign) BOOL isWebDebuggable;
/**
 @brief Whether or not the webview will have focus.
 @discussion Defaults to @c true.  Set by @c ios.initialFocus in the configuration file.
 */
@property (nonatomic, assign) BOOL hasInitialFocus;

/**
 @brief How the web view will inset its content
 @discussion Set by @c ios.contentInset in the configuration file. Corresponds to @c contentInsetAdjustmentBehavior on WKWebView.
 */
@property (nonatomic, assign) UIScrollViewContentInsetAdjustmentBehavior contentInsetAdjustmentBehavior;
/**
 @brief The base file URL from which Capacitor will load resources
 @discussion Defaults to @c public/ located at the root of the application bundle.
 */
@property (nonatomic, copy, nonnull) NSURL *appLocation;
/**
 @brief The path (relative to @c appLocation) which Capacitor will use for the inital URL at launch.
 @discussion Defaults to nil, in which case Capacitor will attempt to load @c index.html.
 */
@property (nonatomic, copy, nullable) NSString *appStartPath;
/**
 @brief Whether or not the Capacitor WebView will limit the navigation to @c WKAppBoundDomains listed in the Info.plist.
 @discussion Defaults to @c false. Set by @c ios.limitsNavigationsToAppBoundDomains in the configuration file.  Required to be @c true for plugins to work if the app includes @c WKAppBoundDomains in the Info.plist.
 */
@property (nonatomic, assign) BOOL limitsNavigationsToAppBoundDomains;
/**
 @brief The content mode for the web view to use when it loads and renders web content.
 @discussion Defaults to  @c recommended. Set by @c ios.preferredContentMode in the configuration file.
 */
@property (nonatomic, copy, nullable) NSString *preferredContentMode;
/**
 @brief The parser used to load the cofiguration for Cordova plugins.
 */
@property (nonatomic, copy, nonnull) CDVConfigParser *cordovaConfiguration;
/**
 @brief Warnings generated during initialization.
 */
@property (nonatomic, assign) CAPInstanceWarning warnings;
/**
 @brief The type of instance.
 */
@property (nonatomic, readonly) CAPInstanceType instanceType;
/**
 @brief The JSON dictionary representing the contents of the configuration file.
 @warning Deprecated. Do not use.
 */
@property (nonatomic, retain, nonnull) NSDictionary *legacyConfig;
/**
 @brief Initialize the descriptor with the default environment. This assumes that the application was built with the help of the Capacitor CLI and that that the web app is located inside the application bundle at @c public/.
 */
- (instancetype _Nonnull)initAsDefault NS_SWIFT_NAME(init());
/**
 @brief Initialize the descriptor for use in other contexts. The app location is the one required parameter.
 @param appURL The location of the folder containing the web app.
 @param configURL The location of the Capacitor configuration file.
 @param cordovaURL The location of the Cordova configuration file.
 */
- (instancetype _Nonnull)initAtLocation:(NSURL* _Nonnull)appURL configuration:(NSURL* _Nullable)configURL cordovaConfiguration:(NSURL* _Nullable)cordovaURL NS_SWIFT_NAME(init(at:configuration:cordovaConfiguration:));
@end

#endif /* CAPInstanceDescriptor_h */
