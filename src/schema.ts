/**
 * The subset of AnyList's protobuf schema that this client needs.
 *
 * AnyList has no public API. The message and field numbers below were taken from
 * the protobuf definitions published in the MIT-licensed `anylist` npm package
 * by Max Isom (https://github.com/codetheweb/anylist), which in turn reverse
 * engineered the AnyList web app. Fields we do not use are left out: protobuf
 * skips unknown fields when decoding, so this is safe for reading.
 */
export const SCHEMA = `
syntax = "proto2";
package pcov.proto;

message PBItemQuantity {
  optional string amount = 1;
  optional string unit = 2;
  optional string rawQuantity = 3;
}

message ListItem {
  optional string identifier = 1;
  optional double serverModTime = 2;
  optional string listId = 3;
  optional string name = 4;
  optional string details = 5;
  optional bool checked = 6;
  optional string category = 11;
  optional string userId = 12;
  optional string categoryMatchId = 13;
  optional int32 manualSortIndex = 17;
  optional string deprecatedQuantity = 18;
  optional PBItemQuantity quantityPb = 21;
}

message ShoppingList {
  optional string identifier = 1;
  optional double timestamp = 2;
  optional string name = 3;
  repeated ListItem items = 4;
  optional string creator = 5;
}

message ShoppingListsResponse {
  repeated ShoppingList newLists = 1;
}

message PBUserDataResponse {
  optional ShoppingListsResponse shoppingListsResponse = 1;
}

message PBOperationMetadata {
  optional string operationId = 1;
  optional string handlerId = 2;
  optional string userId = 3;
}

message PBListOperation {
  optional PBOperationMetadata metadata = 1;
  optional string listId = 2;
  optional string listItemId = 3;
  optional string updatedValue = 4;
  optional string originalValue = 5;
  optional ListItem listItem = 6;
}

message PBListOperationList {
  repeated PBListOperation operations = 1;
}
`;
