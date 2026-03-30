#ifndef CAPInstanceConfiguration_h
#define CAPInstanceConfiguration_h

@import UIKit;

@class CAPInstanceDescriptor;

NS_SWIFT_NAME(InstanceConfiguration)
@interface CAPInstanceConfiguration: NSObject
@property (nonatomic, readonly, nullable) NSString *appendedUserAgentString;
@property (nonatomic, readonly, nullable) NSString *overridenUserAgentString;
@property (nonatomic, readonly, nullable) UIColor *backgroundColor;
@property (nonatomic, readonly, nonnull) NSArray<NSString*> *allowedNavigationHostnames;
@property (nonatomic, readonly, nonnull) NSURL *localURL;
@property (nonatomic, readonly, nonnull) NSURL *serverURL;
@property (nonatomic, readonly, nullable) NSString *errorPath;
@property (nonatomic, readonly, nonnull) NSDictionary *pluginConfigurations;
@property (nonatomic, readonly) BOOL loggingEnabled;
@property (nonatomic, readonly) BOOL scrollingEnabled;
@property (nonatomic, readonly) BOOL zoomingEnabled;
@property (nonatomic, readonly) BOOL allowLinkPreviews;
@property (nonatomic, readonly) BOOL handleApplicationNotifications;
@property (nonatomic, readonly) BOOL isWebDebuggable;
@property (nonatomic, readonly) BOOL hasInitialFocus;
@property (nonatomic, readonly) BOOL cordovaDeployDisabled;
@property (nonatomic, readonly) UIScrollViewContentInsetAdjustmentBehavior contentInsetAdjustmentBehavior;
@property (nonatomic, readonly, nonnull) NSURL *appLocation;
@property (nonatomic, readonly, nullable) NSString *appStartPath;
@property (nonatomic, readonly) BOOL limitsNavigationsToAppBoundDomains;
@property (nonatomic, readonly, nullable) NSString *preferredContentMode;

@property (nonatomic, readonly, nonnull) NSDictionary *legacyConfig DEPRECATED_MSG_ATTRIBUTE("Use direct properties instead");

- (instancetype _Nonnull)initWithDescriptor:(CAPInstanceDescriptor* _Nonnull)descriptor isDebug:(BOOL)debug NS_SWIFT_NAME(init(with:isDebug:));
- (instancetype _Nonnull)updatingAppLocation:(NSURL* _Nonnull)location NS_SWIFT_NAME(updatingAppLocation(_:));
@end

#endif /* CAPInstanceConfiguration_h */
