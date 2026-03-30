#import "CAPPluginCall.h"
#import "CAPPlugin.h"

typedef enum {
  CAPPluginMethodArgumentNotNullable,
  CAPPluginMethodArgumentNullable
} CAPPluginMethodArgumentNullability;

typedef NSString CAPPluginReturnType;

/**
 * Represents a single argument to a plugin method.
 */
@interface CAPPluginMethodArgument : NSObject

@property (nonatomic, copy) NSString *name;
@property (nonatomic, assign) CAPPluginMethodArgumentNullability nullability;

- (instancetype)initWithName:(NSString *)name nullability:(CAPPluginMethodArgumentNullability)nullability type:(NSString *)type;

@end

/**
 * Represents a method that a plugin supports, with the ability
 * to compute selectors and invoke the method.
 */
@interface CAPPluginMethod : NSObject

@property (nonatomic, assign) SEL selector;
@property (nonatomic, strong) NSString *name; // Raw method name
@property (nonatomic, strong) CAPPluginReturnType *returnType; // Return type of method (i.e. callback/promise/sync)

- (instancetype)initWithName:(NSString *)name returnType:(CAPPluginReturnType *)returnType;
- (instancetype)initWithSelector:(SEL)selector returnType:(CAPPluginReturnType *)returnType;

@end
